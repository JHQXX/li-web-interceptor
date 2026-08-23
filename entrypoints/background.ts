import { browser } from 'wxt/browser';
import {
  loadState,
  saveState,
  updateState,
  getActiveProfile,
  updateActiveProfile,
  pushHistory,
  pruneState,
  resetAttemptCountersIfNewDay,
  resetPomodoroDayIfNewDay,
  clearHostGrants,
} from '@/utils/storage';
import { decide, resolveBlockTarget, computePatterns } from '@/utils/rules';
import { getHostname, normalizeHost } from '@/utils/domain';
import { hashPassword, verifyPassword, generatePassword, encryptText, decryptText } from '@/utils/crypto';
import { buildSnapshot, serializeSnapshot, parseSnapshot, applySnapshot } from '@/utils/snapshot';
import { uid } from '@/utils/id';
import { getSyncProvider } from '@/sync';
import type { SyncConfigInput } from '@/sync/types';
import {
  pomodoroAdvance,
  pomodoroPause,
  pomodoroRemainingSec,
  pomodoroResume,
  pomodoroStart,
  pomodoroStop,
} from '@/utils/time';
import { t } from '@/utils/i18n';
import type { Message, AddBlockPayload, AddWhitelistPayload } from '@/utils/messaging';
import type {
  AppState,
  BlockRule,
  HistoryAction,
  Profile,
  WhitelistRule,
} from '@/utils/types';

const MENU_BLOCK_PAGE = 'liwi-block-page';
const MENU_BLOCK_LINK = 'liwi-block-link';
const POMODORO_ALARM = 'liwi-pomodoro';

function blockedPageUrl(originalUrl: string, host: string, ruleId?: string): string {
  const params = new URLSearchParams();
  if (originalUrl) params.set('url', originalUrl);
  if (host) params.set('site', host);
  if (ruleId) params.set('ruleId', ruleId);
  const q = params.toString();
  return `${browser.runtime.getURL('/blocked.html')}${q ? '?' + q : ''}`;
}

// ---------------------------------------------------------------- 规则构建

function makeBlockRule(profile: Profile, p: AddBlockPayload): BlockRule {
  const v = profile.settings.variants;
  const domainOpts = p.domainOptions ?? { includeSubdomains: v.includeSubdomains, includeTldVariants: v.includeTldVariants, includeKnownMirrors: v.includeKnownMirrors };
  return {
    id: uid('br_'),
    text: p.text.trim(),
    matchMode: p.matchMode,
    domainOptions: p.matchMode === 'domain' ? domainOpts : undefined,
    patterns: p.matchMode === 'domain' ? computePatterns(p.text, domainOpts) : undefined,
    blockType: p.blockType,
    attempts: p.blockType === 'attemptwise' ? Math.max(1, p.attempts ?? 5) : undefined,
    durationMs: p.blockType === 'timewise' ? (p.durationMs ?? 30 * 60_000) : null,
    schedule: p.blockType === 'schedule' ? p.schedule : undefined,
    status: 'blocked',
    redirectUrl: p.redirectUrl || undefined,
    reason: p.reason ?? '',
    createdAt: Date.now(),
  };
}

function makeWhitelistRule(p: AddWhitelistPayload): WhitelistRule {
  const domainOpts = { includeSubdomains: true, includeTldVariants: false, includeKnownMirrors: false };
  return {
    id: uid('wl_'),
    text: p.text.trim(),
    matchMode: p.matchMode,
    domainOptions: p.matchMode === 'domain' ? domainOpts : undefined,
    patterns: p.matchMode === 'domain' ? computePatterns(p.text, domainOpts) : undefined,
    type: p.type,
    attempts: p.type === 'attemptwise' ? Math.max(1, p.attempts ?? 10) : undefined,
    schedule: p.type === 'schedule' ? p.schedule : undefined,
    status: 'allowed',
    createdAt: Date.now(),
  };
}

function dedupeBlock(profile: Profile, rule: BlockRule): { profile: Profile; rule: BlockRule } {
  const idx = profile.blockList.findIndex((r) => r.text === rule.text && r.matchMode === rule.matchMode);
  if (idx < 0) return { profile: { ...profile, blockList: [...profile.blockList, rule] }, rule };
  const existing = profile.blockList[idx]!;
  const updated: BlockRule = { ...existing, ...rule, id: existing.id, createdAt: existing.createdAt };
  return {
    profile: { ...profile, blockList: profile.blockList.map((r) => (r.id === existing.id ? updated : r)) },
    rule: updated,
  };
}

function dedupeWhitelist(profile: Profile, rule: WhitelistRule): { profile: Profile; rule: WhitelistRule } {
  const idx = profile.whitelist.findIndex((r) => r.text === rule.text && r.matchMode === rule.matchMode);
  if (idx < 0) return { profile: { ...profile, whitelist: [...profile.whitelist, rule] }, rule };
  const existing = profile.whitelist[idx]!;
  const updated: WhitelistRule = { ...existing, ...rule, id: existing.id, createdAt: existing.createdAt };
  return {
    profile: { ...profile, whitelist: profile.whitelist.map((r) => (r.id === existing.id ? updated : r)) },
    rule: updated,
  };
}

async function notify(title: string, message: string) {
  try {
    await browser.notifications.create({ type: 'basic', iconUrl: 'icon/128.png', title, message });
  } catch {
    // 忽略
  }
}

// ---------------------------------------------------------------- 判定流程

async function processUrl(url: string, tabId: number) {
  if (!/^https?:/i.test(url)) return;
  const host = getHostname(url);
  if (!host) return;

  let state = await loadState();
  state = resetAttemptCountersIfNewDay(pruneState(state));
  if (!state.lockEnabled) return;

  const profile = getActiveProfile(state);
  const decision = decide(url, host, {
    blockList: profile.blockList,
    whitelist: profile.whitelist,
    keywords: profile.keywords,
    keywordBlockingEnabled: profile.settings.keywordBlockingEnabled,
    whitelistMode: profile.settings.whitelistMode,
    sessionUnlocks: state.sessionUnlocks,
    activeCountdowns: state.activeCountdowns,
    activeTimewise: state.activeTimewise,
    attemptState: state.attemptState,
    whitelistAttemptState: state.whitelistAttemptState,
  });

  if (decision.status === 'allowed') {
    let changed = false;
    if (decision.cause === 'attempt-allowed' && decision.ruleId) {
      state.attemptState[decision.ruleId] = (state.attemptState[decision.ruleId] ?? 0) + 1;
      changed = true;
    }
    if (decision.cause === 'whitelist' && decision.whitelistRuleId) {
      const wl = profile.whitelist.find((w) => w.id === decision.whitelistRuleId);
      if (wl?.type === 'attemptwise') {
        state.whitelistAttemptState[decision.whitelistRuleId] = (state.whitelistAttemptState[decision.whitelistRuleId] ?? 0) + 1;
        changed = true;
      }
    }
    if (decision.cause === 'countdown-done') {
      state.activeCountdowns = state.activeCountdowns.filter((c) => c.hostname !== normalizeHost(host));
      changed = true;
    }
    if (changed) await saveState(state);
    return;
  }

  // blocked
  let changed = false;
  if (decision.rule && decision.rule.blockType === 'timewise' && decision.rule.durationMs) {
    const existing = state.activeTimewise[decision.rule.id];
    if (existing == null || existing <= Date.now()) {
      state.activeTimewise[decision.rule.id] = Date.now() + decision.rule.durationMs;
      changed = true;
    }
  }
  const action: HistoryAction =
    decision.cause === 'keyword' ? 'keyword'
    : decision.cause === 'allowlist' ? 'allowlist'
    : profile.settings.silentMode ? 'silent'
    : 'blocked';
  if (state.historyEnabled) {
    state = pushHistory(state, {
      url,
      host,
      label: decision.keyword ?? decision.rule?.text ?? t('actionAllowlist'),
      action,
    });
    changed = true;
  }
  if (changed) await saveState(state);

  if (profile.settings.silentMode) {
    try {
      await browser.tabs.remove(tabId);
    } catch {
      // 标签页可能已关闭
    }
    await updateBadge(state);
    return;
  }

  const target = resolveBlockTarget(decision.rule, profile.settings.blockPage, blockedPageUrl(url, host, decision.rule?.id));
  try {
    await browser.tabs.update(tabId, { url: target });
  } catch {
    // 忽略
  }
  await updateBadge(state);
}

// ---------------------------------------------------------------- 角标

async function updateBadge(state?: AppState) {
  if (!state) state = await loadState();
  const p = state.pomodoro;
  if (p.status === 'focus' || p.status === 'break' || p.status === 'paused') {
    const sec = pomodoroRemainingSec(p);
    const min = Math.max(1, Math.ceil(sec / 60));
    await browser.action.setBadgeText({ text: String(min) });
    await browser.action.setBadgeBackgroundColor({ color: p.status === 'break' ? '#4caf50' : '#E64A19' });
    return;
  }
  let best: number | null = null;
  for (const until of Object.values(state.activeTimewise)) {
    const rem = until - Date.now();
    if (rem > 0 && (best == null || rem < best)) best = rem;
  }
  for (const cd of state.activeCountdowns) {
    const rem = cd.unlocksAt - Date.now();
    if (rem > 0 && (best == null || rem < best)) best = rem;
  }
  if (best != null) {
    const min = Math.max(1, Math.ceil(best / 60000));
    await browser.action.setBadgeText({ text: `${min}m` });
    await browser.action.setBadgeBackgroundColor({ color: '#E64A19' });
    return;
  }
  await browser.action.setBadgeText({ text: '' });
}

// ---------------------------------------------------------------- 上下文菜单

async function setupContextMenus() {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({ id: MENU_BLOCK_PAGE, title: t('ctxBlockSite'), contexts: ['page', 'frame'] });
  browser.contextMenus.create({ id: MENU_BLOCK_LINK, title: t('ctxBlockLink'), contexts: ['link'] });
}

async function handleContextMenuClick(info: {
  menuItemId: number | string;
  pageUrl?: string;
  linkUrl?: string;
  tabId?: number;
}) {
  if (info.menuItemId === MENU_BLOCK_LINK) {
    const url = info.linkUrl;
    if (!url) return;
    const host = getHostname(url);
    if (!host) return;
    await updateState((s) => {
      const profile = getActiveProfile(s);
      const rule = makeBlockRule(profile, { text: host, matchMode: 'domain', blockType: 'permanent' });
      const next = updateActiveProfile(s, (p) => dedupeBlock(p, rule).profile);
      return clearHostGrants(next, host);
    });
    return;
  }
  const url = info.pageUrl;
  if (!url) return;
  const host = getHostname(url);
  if (!host) return;
  await updateState((s) => {
    const profile = getActiveProfile(s);
    const rule = makeBlockRule(profile, { text: host, matchMode: 'domain', blockType: 'permanent' });
    return updateActiveProfile(s, (p) => dedupeBlock(p, rule).profile);
  });
  if (info.tabId != null) {
    try {
      await processUrl(url, info.tabId);
    } catch {
      // 忽略
    }
  }
}

// ---------------------------------------------------------------- 番茄钟 alarm

async function ensurePomodoroAlarm(state: AppState) {
  const active = state.pomodoro.status !== 'idle';
  try {
    if (active) await browser.alarms.create(POMODORO_ALARM, { periodInMinutes: 0.5 });
    else await browser.alarms.clear(POMODORO_ALARM);
  } catch {
    // 忽略
  }
}

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== POMODORO_ALARM) return;
  const state = await loadState();
  const adv = pomodoroAdvance(state.pomodoro);
  if (adv.changed) {
    await updateState((s) => ({ ...s, pomodoro: adv.state }));
    await ensurePomodoroAlarm({ ...state, pomodoro: adv.state });
    if (adv.state.status === 'break') {
      await notify(t('notifyFocusEnd'), t('notifyBreakStart'));
    } else if (adv.state.status === 'focus') {
      await notify(t('notifyBreakEnd'), t('notifyFocusStart'));
    } else if (adv.state.status === 'idle') {
      await notify(t('notifyPomoDone'), t('notifyPomoDoneMsg', [adv.state.sessionsCompleted]));
    }
  }
  await updateBadge();
});

// ---------------------------------------------------------------- omnibox / commands

function setLockEnabledState(state: AppState, enabled: boolean): { state: AppState; error?: string } {
  const now = Date.now();
  if (enabled) {
    if (state.cooldownMinutes > 0 && state.cooldownUntil != null && state.cooldownUntil > now) {
      return { state, error: t('coolingActive') };
    }
    return { state: { ...state, lockEnabled: true, cooldownUntil: null } };
  }
  return {
    state: {
      ...state,
      lockEnabled: false,
      cooldownUntil: state.cooldownMinutes > 0 ? now + state.cooldownMinutes * 60_000 : null,
    },
  };
}

async function addBlockForHost(host: string) {
  await updateState((s) => {
    const profile = getActiveProfile(s);
    const rule = makeBlockRule(profile, { text: host, matchMode: 'domain', blockType: 'permanent' });
    const next = updateActiveProfile(s, (p) => dedupeBlock(p, rule).profile);
    return clearHostGrants(next, host);
  });
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && tab.id != null) {
    try {
      await processUrl(tab.url, tab.id);
    } catch {
      // 忽略
    }
  }
}

async function handleOmnibox(text: string) {
  const input = text.trim();
  if (!input) return;
  const [cmd, ...rest] = input.split(/\s+/);
  const arg = rest.join(' ');
  switch (cmd) {
    case 'add':
    case 'block':
    case 'b': {
      if (arg) await addBlockForHost(normalizeHost(arg));
      else await browser.runtime.openOptionsPage();
      break;
    }
    case 'allow':
    case 'white':
    case 'w': {
      if (arg) {
        const host = normalizeHost(arg);
        await updateState((s) => {
          const profile = getActiveProfile(s);
          const made = makeWhitelistRule({ text: host, matchMode: 'domain', type: 'permanent' });
          return updateActiveProfile(s, (p) => dedupeWhitelist(p, made).profile);
        });
      } else {
        await browser.runtime.openOptionsPage();
      }
      break;
    }
    case 'on': {
      const state = await updateState((s) => setLockEnabledState(s, true).state);
      await updateBadge(state);
      break;
    }
    case 'off': {
      const state = await updateState((s) => setLockEnabledState(s, false).state);
      await updateBadge(state);
      break;
    }
    case 'list':
    case 'help': {
      await browser.runtime.openOptionsPage();
      break;
    }
    default: {
      // 默认把输入当作域名加入拦截
      if (input.includes('.')) await addBlockForHost(normalizeHost(input));
      else await browser.runtime.openOptionsPage();
    }
  }
}

async function handleCommand(command: string) {
  if (command === 'toggle-lock') {
    const state = await loadState();
    const next = setLockEnabledState(state, !state.lockEnabled);
    if (!next.error) {
      await saveState(next.state);
      await updateBadge(next.state);
    }
  } else if (command === 'block-tab') {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const host = tab?.url ? getHostname(tab.url) : null;
    if (host && tab?.id != null) {
      await addBlockForHost(host);
    }
  }
}

// ---------------------------------------------------------------- 同步配置

async function getSyncConfig(state: AppState): Promise<SyncConfigInput | null> {
  const sync = state.sync;
  if (!sync.configEnc || !sync.encKey) return null;
  try {
    const json = await decryptText(sync.encKey, sync.configEnc);
    const cfg = JSON.parse(json) as SyncConfigInput;
    return cfg;
  } catch {
    return null;
  }
}

async function setSyncConfig(payload: { provider: 'webdav' | 's3'; endpoint: string; path: string; username?: string; password?: string; region?: string; bucket?: string; accessKey?: string; secretKey?: string }) {
  const state = await loadState();
  const encKey = state.sync.encKey ?? Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const cfg: SyncConfigInput = {
    provider: payload.provider,
    endpoint: payload.endpoint.trim(),
    path: payload.path.trim(),
    username: payload.username,
    password: payload.password,
    region: payload.region,
    bucket: payload.bucket,
    accessKey: payload.accessKey,
    secretKey: payload.secretKey,
  };
  const configEnc = await encryptText(encKey, JSON.stringify(cfg));
  await updateState((s) => ({ ...s, sync: { ...s.sync, provider: payload.provider, enabled: true, configEnc, encKey, lastError: null } }));
}

// ---------------------------------------------------------------- 消息处理

async function handleMessage(message: Message) {
  switch (message.type) {
    case 'get-state': {
      const state = await loadState();
      return { ok: true, state } as const;
    }
    case 'get-tab-info': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? null;
      const host = url ? getHostname(url) : null;
      return { ok: true, url, host, tabId: tab?.id } as const;
    }
    case 'add-block': {
      const { tabId, url, ...payload } = message.payload;
      let rule: BlockRule | undefined;
      const state = await updateState((s) => {
        const profile = getActiveProfile(s);
        const made = makeBlockRule(profile, payload);
        const { profile: next, rule: r } = dedupeBlock(profile, made);
        rule = r;
        const withRule = updateActiveProfile(s, () => next);
        return clearHostGrants(withRule, payload.text);
      });
      rule = rule ?? getActiveProfile(state).blockList.find((r) => r.text === payload.text.trim())!;
      if (tabId != null && url) {
        try {
          await processUrl(url, tabId);
        } catch {
          // 忽略
        }
      }
      return { ok: true, rule } as const;
    }
    case 'remove-block': {
      await updateState((s) => {
        const profile = getActiveProfile(s);
        const target = profile.blockList.find((r) => r.id === message.payload.id);
        const next = updateActiveProfile(s, (p) => ({ ...p, blockList: p.blockList.filter((r) => r.id !== message.payload.id) }));
        return target ? clearHostGrants(next, target.text) : next;
      });
      return { ok: true } as const;
    }
    case 'update-block': {
      await updateState((s) =>
        updateActiveProfile(s, (p) => ({
          ...p,
          blockList: p.blockList.map((r) => {
            if (r.id !== message.payload.id) return r;
            const changes = message.payload.changes;
            const next = { ...r, ...changes };
            // 子域 / 变体开关变更时，重算衍生匹配模式，使其真正生效
            if (changes.includeSubdomains !== undefined || changes.includeVariants !== undefined) {
              const cur = r.domainOptions ?? { includeSubdomains: false, includeTldVariants: false, includeKnownMirrors: false };
              const sub = changes.includeSubdomains !== undefined ? Boolean(changes.includeSubdomains) : Boolean(cur.includeSubdomains);
              const varFlag = changes.includeVariants !== undefined ? Boolean(changes.includeVariants) : Boolean(cur.includeTldVariants || cur.includeKnownMirrors);
              const domainOptions = { includeSubdomains: sub, includeTldVariants: varFlag, includeKnownMirrors: varFlag };
              return { ...next, domainOptions, patterns: computePatterns(r.text, domainOptions) };
            }
            return next;
          }),
        })),
      );
      return { ok: true } as const;
    }
    case 'set-rule-status': {
      await updateState((s) =>
        updateActiveProfile(s, (p) => ({
          ...p,
          blockList: p.blockList.map((r) => (r.id === message.payload.id ? { ...r, status: message.payload.status } : r)),
        })),
      );
      return { ok: true } as const;
    }
    case 'add-whitelist': {
      await updateState((s) => {
        const profile = getActiveProfile(s);
        const made = makeWhitelistRule(message.payload);
        return updateActiveProfile(s, (p) => dedupeWhitelist(p, made).profile);
      });
      return { ok: true } as const;
    }
    case 'remove-whitelist': {
      await updateState((s) =>
        updateActiveProfile(s, (p) => ({ ...p, whitelist: p.whitelist.filter((r) => r.id !== message.payload.id) })),
      );
      return { ok: true } as const;
    }
    case 'update-whitelist': {
      await updateState((s) =>
        updateActiveProfile(s, (p) => ({
          ...p,
          whitelist: p.whitelist.map((r) =>
            r.id === message.payload.id ? { ...r, ...message.payload.changes } : r,
          ),
        })),
      );
      return { ok: true } as const;
    }
    case 'set-whitelist-status': {
      await updateState((s) =>
        updateActiveProfile(s, (p) => ({
          ...p,
          whitelist: p.whitelist.map((r) => (r.id === message.payload.id ? { ...r, status: message.payload.status } : r)),
        })),
      );
      return { ok: true } as const;
    }
    case 'add-keyword': {
      await updateState((s) =>
        updateActiveProfile(s, (p) => ({ ...p, keywords: [...p.keywords, { id: uid('kw_'), keyword: message.payload.keyword.trim(), enabled: true }] })),
      );
      return { ok: true } as const;
    }
    case 'remove-keyword': {
      await updateState((s) =>
        updateActiveProfile(s, (p) => ({ ...p, keywords: p.keywords.filter((k) => k.id !== message.payload.id) })),
      );
      return { ok: true } as const;
    }
    case 'toggle-keyword': {
      await updateState((s) =>
        updateActiveProfile(s, (p) => ({
          ...p,
          keywords: p.keywords.map((k) => (k.id === message.payload.id ? { ...k, enabled: message.payload.enabled } : k)),
        })),
      );
      return { ok: true } as const;
    }
    case 'set-keyword-blocking': {
      await updateState((s) => updateActiveProfile(s, (p) => ({ ...p, settings: { ...p.settings, keywordBlockingEnabled: message.payload.enabled } })));
      return { ok: true } as const;
    }
    case 'set-whitelist-mode': {
      await updateState((s) => updateActiveProfile(s, (p) => ({ ...p, settings: { ...p.settings, whitelistMode: message.payload.enabled } })));
      return { ok: true } as const;
    }
    case 'set-silent-mode': {
      await updateState((s) => updateActiveProfile(s, (p) => ({ ...p, settings: { ...p.settings, silentMode: message.payload.enabled } })));
      return { ok: true } as const;
    }
    case 'set-lock-enabled': {
      const state = await loadState();
      const next = setLockEnabledState(state, message.payload.enabled);
      if (next.error) {
        return { ok: false, error: next.error, remainingMs: (state.cooldownUntil ?? 0) - Date.now() } as const;
      }
      await saveState(next.state);
      await updateBadge(next.state);
      return { ok: true } as const;
    }
    case 'set-history-enabled': {
      await updateState((s) => ({ ...s, historyEnabled: message.payload.enabled }));
      return { ok: true } as const;
    }
    case 'set-cooldown': {
      await updateState((s) => ({
        ...s,
        cooldownMinutes: Math.max(0, Math.min(60, message.payload.minutes)),
        cooldownUntil: message.payload.minutes === 0 ? null : s.cooldownUntil,
      }));
      return { ok: true } as const;
    }
    case 'set-password-enabled': {
      await updateState((s) => ({ ...s, password: { ...s.password, enabled: message.payload.enabled } }));
      return { ok: true } as const;
    }
    case 'reset-password': {
      const password = generatePassword();
      const { hash, salt } = await hashPassword(password);
      await updateState((s) => ({ ...s, password: { enabled: true, hash, salt } }));
      return { ok: true, password } as const;
    }
    case 'set-security-question': {
      const answer = message.payload.answer.trim();
      if (!answer) return { ok: false, error: t('pwdSecurityNeedAnswer') } as const;
      const { hash, salt } = await hashPassword(answer);
      await updateState((s) => ({ ...s, security: { question: message.payload.question, answerHash: hash, answerSalt: salt } }));
      return { ok: true } as const;
    }
    case 'reset-password-via-security': {
      const state = await loadState();
      const sec = state.security;
      if (!sec.answerHash || !sec.answerSalt) return { ok: false, error: t('securityNotSet') } as const;
      const valid = await verifyPassword(message.payload.answer.trim(), sec.answerHash, sec.answerSalt);
      if (!valid) return { ok: false, error: t('securityAnswerWrong') } as const;
      const password = generatePassword();
      const { hash, salt } = await hashPassword(password);
      await updateState((s) => ({ ...s, password: { enabled: true, hash, salt } }));
      return { ok: true, password } as const;
    }
    case 'verify-password': {
      const state = await loadState();
      const p = state.password;
      if (!p.enabled || !p.hash || !p.salt) return { ok: true, valid: false } as const;
      const valid = await verifyPassword(message.payload.password, p.hash, p.salt);
      return { ok: true, valid } as const;
    }
    case 'set-block-page': {
      await updateState((s) => updateActiveProfile(s, (p) => ({ ...p, settings: { ...p.settings, blockPage: { ...p.settings.blockPage, ...message.payload } } })));
      return { ok: true } as const;
    }
    case 'set-variants': {
      await updateState((s) => updateActiveProfile(s, (p) => ({ ...p, settings: { ...p.settings, variants: message.payload.variants } })));
      return { ok: true } as const;
    }
    case 'create-profile': {
      const state = await updateState((s) => {
        const src = getActiveProfile(s);
        const newProfile: Profile = {
          id: uid('prof_'),
          name: message.payload.name.trim() || t('profileDefaultName'),
          blockList: message.payload.inherit ? [...src.blockList] : [],
          whitelist: message.payload.inherit ? [...src.whitelist] : [],
          keywords: message.payload.inherit ? [...src.keywords] : [],
          settings: message.payload.inherit ? JSON.parse(JSON.stringify(src.settings)) : JSON.parse(JSON.stringify(src.settings)),
        };
        if (!message.payload.inherit) {
          newProfile.blockList = [];
          newProfile.whitelist = [];
          newProfile.keywords = [];
        }
        return { ...s, profiles: [...s.profiles, newProfile], activeProfileId: newProfile.id };
      });
      return { ok: true } as const;
    }
    case 'switch-profile': {
      const state = await updateState((s) => (s.profiles.some((p) => p.id === message.payload.id) ? { ...s, activeProfileId: message.payload.id } : s));
      return { ok: true } as const;
    }
    case 'rename-profile': {
      await updateState((s) => ({
        ...s,
        profiles: s.profiles.map((p) => (p.id === message.payload.id ? { ...p, name: message.payload.name.trim() || p.name } : p)),
      }));
      return { ok: true } as const;
    }
    case 'delete-profile': {
      const state = await loadState();
      if (state.profiles.length <= 1) return { ok: false, error: t('profileDeleteErrLast') } as const;
      if (state.activeProfileId === message.payload.id) return { ok: false, error: t('profileDeleteErrActive') } as const;
      await updateState((s) => ({ ...s, profiles: s.profiles.filter((p) => p.id !== message.payload.id) }));
      return { ok: true } as const;
    }
    case 'start-countdown': {
      await updateState((s) => {
        const host = normalizeHost(message.payload.host);
        const profile = getActiveProfile(s);
        const exists = profile.blockList.some((r) => modeMatchesHostHost(r, host));
        if (!exists) return s;
        s.activeCountdowns = s.activeCountdowns.filter((c) => c.hostname !== host);
        s.activeCountdowns.push({ id: uid('cd_'), hostname: host, unlocksAt: Date.now() + message.payload.minutes * 60_000 });
        return s;
      });
      await updateBadge();
      return { ok: true } as const;
    }
    case 'session-unlock': {
      await updateState((s) => {
        const host = normalizeHost(message.payload.host);
        s.sessionUnlocks = s.sessionUnlocks.filter((x) => x.hostname !== host);
        s.sessionUnlocks.push({ id: uid('su_'), hostname: host, expiresAt: Date.now() + message.payload.minutes * 60_000 });
        return s;
      });
      return { ok: true } as const;
    }
    case 'remove-countdown': {
      await updateState((s) => {
        s.activeCountdowns = s.activeCountdowns.filter((c) => c.hostname !== normalizeHost(message.payload.host));
        return s;
      });
      await updateBadge();
      return { ok: true } as const;
    }
    case 'export-snapshot': {
      const state = await loadState();
      const json = serializeSnapshot(buildSnapshot(state));
      return { ok: true, json } as const;
    }
    case 'import-snapshot': {
      const snap = parseSnapshot(message.payload.json);
      await updateState((s) => applySnapshot(s, snap));
      return { ok: true } as const;
    }
    case 'export-csv': {
      const state = await loadState();
      const profile = getActiveProfile(state);
      if (message.payload.kind === 'block') {
        const rows = [[t('site'), t('colMatch'), t('colType'), t('blStatus'), t('colReason')]];
        for (const r of profile.blockList) rows.push([r.text, r.matchMode, r.blockType, r.status, r.reason]);
        return { ok: true, csv: toCsv(rows), filename: 'block-list.csv' } as const;
      }
      const rows = [[t('allowDomain'), t('colMatch'), t('colType'), t('blStatus')]];
      for (const r of profile.whitelist) rows.push([r.text, r.matchMode, r.type, r.status]);
      return { ok: true, csv: toCsv(rows), filename: 'whitelist.csv' } as const;
    }
    case 'clear-history': {
      await updateState((s) => ({ ...s, history: [] }));
      return { ok: true } as const;
    }
    case 'reset-attempts': {
      await updateState((s) => ({ ...s, attemptState: {}, whitelistAttemptState: {} }));
      return { ok: true } as const;
    }
    case 'reset-all': {
      const state = await loadState();
      const next = { ...state, profiles: state.profiles.map((p) => ({ ...p, blockList: [], whitelist: [], keywords: [] })), history: [], sessionUnlocks: [], activeCountdowns: [], activeTimewise: {}, attemptState: {}, whitelistAttemptState: {} };
      await saveState(next);
      await updateBadge(next);
      return { ok: true } as const;
    }
    case 'pomodoro-start': {
      const state = await updateState((s) => ({ ...s, pomodoro: pomodoroStart(s.pomodoro, message.payload.focusMinutes, message.payload.breakMinutes, message.payload.totalCycles) }));
      await ensurePomodoroAlarm(state);
      await updateBadge(state);
      return { ok: true } as const;
    }
    case 'pomodoro-pause': {
      await updateState((s) => ({ ...s, pomodoro: pomodoroPause(s.pomodoro) }));
      await updateBadge();
      return { ok: true } as const;
    }
    case 'pomodoro-resume': {
      const state = await updateState((s) => ({ ...s, pomodoro: pomodoroResume(s.pomodoro) }));
      await ensurePomodoroAlarm(state);
      await updateBadge(state);
      return { ok: true } as const;
    }
    case 'pomodoro-stop': {
      const state = await updateState((s) => ({ ...s, pomodoro: pomodoroStop(s.pomodoro) }));
      await ensurePomodoroAlarm(state);
      await updateBadge(state);
      return { ok: true } as const;
    }
    case 'pomodoro-get': {
      const state = await loadState();
      const remainingSec = pomodoroRemainingSec(state.pomodoro);
      return { ok: true, state: state.pomodoro, remainingSec } as const;
    }
    case 'set-theme': {
      await updateState((s) => ({ ...s, theme: message.payload.theme }));
      return { ok: true } as const;
    }
    case 'set-sync-config': {
      await setSyncConfig(message.payload);
      return { ok: true } as const;
    }
    case 'sync-test': {
      const state = await loadState();
      const cfg = await getSyncConfig(state);
      if (!cfg) return { ok: false, error: t('syncConfigNeeded') } as const;
      const provider = getSyncProvider(cfg.provider);
      if (!provider) return { ok: false, error: t('syncUnknownProvider') } as const;
      return provider.test(cfg);
    }
    case 'sync-push': {
      const state = await loadState();
      const cfg = await getSyncConfig(state);
      if (!cfg) return { ok: false, error: t('syncConfigNeeded') } as const;
      const provider = getSyncProvider(cfg.provider);
      if (!provider) return { ok: false, error: t('syncUnknownProvider') } as const;
      const snapshot = buildSnapshot(state);
      const result = await provider.push(cfg, snapshot);
      if (result.ok) {
        await updateState((s) => ({ ...s, sync: { ...s.sync, lastSyncAt: Date.now(), lastError: null } }));
        return { ok: true, exportedAt: snapshot.exportedAt } as const;
      }
      await updateState((s) => ({ ...s, sync: { ...s.sync, lastError: result.error ?? null } }));
      return { ok: false, error: result.error } as const;
    }
    case 'sync-pull': {
      const state = await loadState();
      const cfg = await getSyncConfig(state);
      if (!cfg) return { ok: false, error: t('syncConfigNeeded') } as const;
      const provider = getSyncProvider(cfg.provider);
      if (!provider) return { ok: false, error: t('syncUnknownProvider') } as const;
      const result = await provider.pull(cfg);
      if (result.ok && result.snapshot) {
        const next = applySnapshot(state, result.snapshot);
        await saveState(next);
        await updateState((s) => ({ ...s, sync: { ...s.sync, lastSyncAt: Date.now(), lastError: null } }));
        return { ok: true, exportedAt: result.snapshot.exportedAt } as const;
      }
      await updateState((s) => ({ ...s, sync: { ...s.sync, lastError: result.error ?? null } }));
      return { ok: false, error: result.error } as const;
    }
    default: {
      return { ok: false, error: t('unknown') } as unknown as never;
    }
  }
}

function modeMatchesHostHost(rule: BlockRule, host: string): boolean {
  if (rule.matchMode === 'domain') {
    const patterns = rule.patterns ?? computePatterns(rule.text, rule.domainOptions);
    return patterns.some((p) => p === host || p === '*.' + host || p === host.replace(/^www\./, ''));
  }
  return rule.text.toLowerCase() === host.toLowerCase();
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

// ---------------------------------------------------------------- 生命周期

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(handleMessage);
  browser.contextMenus.onClicked.addListener(handleContextMenuClick);
  browser.runtime.onInstalled.addListener(() => {
    setupContextMenus().catch(console.error);
  });
  setupContextMenus().catch(console.error);

  browser.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    processUrl(details.url, details.tabId).catch(console.error);
  });

  setInterval(async () => {
    try {
      let state = await loadState();
      state = resetAttemptCountersIfNewDay(pruneState(state));
      state = resetPomodoroDayIfNewDay(state);
      const adv = pomodoroAdvance(state.pomodoro);
      const next = adv.changed ? { ...state, pomodoro: adv.state } : state;
      await saveState(next);
      await ensurePomodoroAlarm(next);
      await updateBadge(next);
    } catch (err) {
      console.error(err);
    }
  }, 30_000);

  browser.omnibox.onInputEntered.addListener(handleOmnibox);
  browser.commands.onCommand.addListener(handleCommand);

  (async () => {
    const state = await resetPomodoroDayIfNewDay(await loadState());
    await saveState(state);
    await ensurePomodoroAlarm(state);
    await updateBadge(state);
  })().catch(console.error);
});

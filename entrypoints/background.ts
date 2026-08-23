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
} from '@/utils/storage';
import { decide, resolveBlockTarget, computePatterns } from '@/utils/rules';
import { getHostname, normalizeHost } from '@/utils/domain';
import { hashPassword, verifyPassword, generatePassword } from '@/utils/crypto';
import { buildSnapshot, serializeSnapshot, parseSnapshot, applySnapshot } from '@/utils/snapshot';
import { uid } from '@/utils/id';
import { PAID_SYNC_ENABLED, getSyncProvider } from '@/sync';
import {
  pomodoroAdvance,
  pomodoroPause,
  pomodoroRemainingSec,
  pomodoroResume,
  pomodoroStart,
  pomodoroStop,
} from '@/utils/time';
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
  const domainOpts = { includeSubdomains: v.includeSubdomains, includeTldVariants: v.includeTldVariants, includeKnownMirrors: v.includeKnownMirrors };
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
      label: decision.keyword ?? decision.rule?.text ?? '全站白名单模式',
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
  browser.contextMenus.create({ id: MENU_BLOCK_PAGE, title: '加入网站拦截器', contexts: ['page', 'frame'] });
  browser.contextMenus.create({ id: MENU_BLOCK_LINK, title: '拦截此链接的网站', contexts: ['link'] });
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
      return updateActiveProfile(s, (p) => ({ ...p, blockList: [...p.blockList, rule] }));
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
    return updateActiveProfile(s, (p) => ({ ...p, blockList: [...p.blockList, rule] }));
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
  }
  await updateBadge();
});

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
      const state = await updateState((s) => {
        const profile = getActiveProfile(s);
        const rule = makeBlockRule(profile, payload);
        return updateActiveProfile(s, (p) => ({ ...p, blockList: [...p.blockList, rule] }));
      });
      const rule = getActiveProfile(state).blockList.find((r) => r.text === payload.text.trim())!;
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
      await updateState((s) =>
        updateActiveProfile(s, (p) => ({ ...p, blockList: p.blockList.filter((r) => r.id !== message.payload.id) })),
      );
      return { ok: true } as const;
    }
    case 'update-block': {
      await updateState((s) =>
        updateActiveProfile(s, (p) => ({
          ...p,
          blockList: p.blockList.map((r) =>
            r.id === message.payload.id ? { ...r, ...message.payload.changes } : r,
          ),
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
      const state = await updateState((s) => {
        const rule = makeWhitelistRule(message.payload);
        return updateActiveProfile(s, (p) => ({ ...p, whitelist: [...p.whitelist, rule] }));
      });
      const rule = getActiveProfile(state).whitelist.find((r) => r.text === message.payload.text.trim())!;
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
      const now = Date.now();
      if (message.payload.enabled) {
        const state = await loadState();
        if (state.cooldownMinutes > 0 && state.cooldownUntil != null && state.cooldownUntil > now) {
          return { ok: false, error: '冷却中', remainingMs: state.cooldownUntil - now } as const;
        }
        await updateState((s) => ({ ...s, lockEnabled: true, cooldownUntil: null }));
      } else {
        await updateState((s) => ({
          ...s,
          lockEnabled: false,
          cooldownUntil: s.cooldownMinutes > 0 ? now + s.cooldownMinutes * 60_000 : null,
        }));
      }
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
      if (!answer) return { ok: false, error: '请填写安全问题答案' } as const;
      const { hash, salt } = await hashPassword(answer);
      await updateState((s) => ({ ...s, security: { question: message.payload.question, answerHash: hash, answerSalt: salt } }));
      return { ok: true } as const;
    }
    case 'reset-password-via-security': {
      const state = await loadState();
      const sec = state.security;
      if (!sec.answerHash || !sec.answerSalt) return { ok: false, error: '尚未设置安全问题' } as const;
      const valid = await verifyPassword(message.payload.answer.trim(), sec.answerHash, sec.answerSalt);
      if (!valid) return { ok: false, error: '安全问题回答错误' } as const;
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
          name: message.payload.name.trim() || '新档案',
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
      if (state.profiles.length <= 1) return { ok: false, error: '至少保留一个档案' } as const;
      if (state.activeProfileId === message.payload.id) return { ok: false, error: '请先切换到其他档案' } as const;
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
        const rows = [['网站', '匹配模式', '拦截类型', '状态', '原因']];
        for (const r of profile.blockList) rows.push([r.text, r.matchMode, r.blockType, r.status, r.reason]);
        return { ok: true, csv: toCsv(rows), filename: 'block-list.csv' } as const;
      }
      const rows = [['放行域名', '匹配模式', '类型', '状态']];
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
    case 'sync-test': {
      if (!PAID_SYNC_ENABLED) return { ok: false, error: '同步功能尚未开放' } as const;
      const provider = getSyncProvider(message.payload.provider);
      if (!provider) return { ok: false, error: '未知同步提供方' } as const;
      return provider.test({ provider: message.payload.provider });
    }
    default: {
      return { ok: false, error: '未知消息类型' } as unknown as never;
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
      const adv = pomodoroAdvance(state.pomodoro);
      const next = adv.changed ? { ...state, pomodoro: adv.state } : state;
      await saveState(next);
      await ensurePomodoroAlarm(next);
      await updateBadge(next);
    } catch (err) {
      console.error(err);
    }
  }, 30_000);

  (async () => {
    const state = await loadState();
    await ensurePomodoroAlarm(state);
    await updateBadge(state);
  })().catch(console.error);
});

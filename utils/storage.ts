/**
 * chrome.storage.local 封装：v2 状态读取/保存/更新、v1→v2 迁移、档案/历史助手。
 */
import { browser } from 'wxt/browser';
import type { AppState, BlockRule, HistoryEntry, Profile, WhitelistRule } from './types';
import { HISTORY_LIMIT, STATE_VERSION } from './types';
import { pomodoroInitial, dateKey } from './time';
import { computePatterns } from './rules';
import { normalizeHost } from './domain';

const STATE_KEY = 'liwi:state:v2';

export function defaultState(): AppState {
  return {
    version: STATE_VERSION,
    profiles: [
      {
        id: 'prof_default',
        name: '默认',
        blockList: [],
        whitelist: [],
        keywords: [],
        settings: {
          variants: {
            includeSubdomains: true,
            includeTldVariants: true,
            includeKnownMirrors: true,
          },
          blockPage: {
            title: '该网站已被拦截',
            message: '专注当前任务，完成后再回来。',
            type: 'message',
            redirectUrl: '',
            autoCloseSeconds: 0,
            showCountdown: true,
            defaultCountdownMs: 30 * 60 * 1000,
          },
          whitelistMode: false,
          keywordBlockingEnabled: false,
          silentMode: false,
        },
      },
    ],
    activeProfileId: 'prof_default',
    lockEnabled: true,
    cooldownMinutes: 0,
    cooldownUntil: null,
    theme: 'light',
    historyEnabled: true,
    password: { enabled: false },
    security: { question: '' },
    sync: { provider: 'none', enabled: false, lastSyncAt: null, lastError: null },
    pomodoro: pomodoroInitial(),
    pomodoroDay: dateKey(),
    history: [],
    sessionUnlocks: [],
    activeCountdowns: [],
    activeTimewise: {},
    attemptState: {},
    whitelistAttemptState: {},
    attemptResetDay: dateKey(),
  };
}

export function getActiveProfile(state: AppState): Profile {
  const found = state.profiles.find((x) => x.id === state.activeProfileId);
  if (found) return found;
  const first = state.profiles[0];
  if (first) return first;
  return defaultState().profiles[0]!;
}

/** 更新当前档案（纯函数，返回新 state） */
export function updateActiveProfile(
  state: AppState,
  updater: (profile: Profile) => Profile,
): AppState {
  const activeId = getActiveProfile(state).id;
  return {
    ...state,
    profiles: state.profiles.map((p) => (p.id === activeId ? updater(p) : p)),
  };
}

/** 写入历史（上限 HISTORY_LIMIT） */
export function pushHistory(state: AppState, entry: Omit<HistoryEntry, 'id' | 'at'>): AppState {
  if (!state.historyEnabled) return state;
  const e: HistoryEntry = {
    ...entry,
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    at: Date.now(),
  };
  return { ...state, history: [e, ...state.history].slice(0, HISTORY_LIMIT) };
}

/** 若跨天则重置按次计数 */
export function resetAttemptCountersIfNewDay(state: AppState, now: number = Date.now()): AppState {
  const key = dateKey(now);
  if (state.attemptResetDay === key) return state;
  return { ...state, attemptResetDay: key, attemptState: {}, whitelistAttemptState: {} };
}

/** 清理过期的会话放行、倒计时与 timewise */
export function pruneState(state: AppState, now: number = Date.now()): AppState {
  return {
    ...state,
    sessionUnlocks: state.sessionUnlocks.filter((s) => s.expiresAt > now),
    activeCountdowns: state.activeCountdowns.filter((c) => c.unlocksAt > now),
    activeTimewise: Object.fromEntries(
      Object.entries(state.activeTimewise).filter(([, until]) => until > now),
    ),
  };
}

// ---------------------------------------------------------------- 迁移

function migrateV1(raw: Record<string, unknown>): AppState {
  const now = Date.now();
  const def = defaultState();
  const defProfile = def.profiles[0]!;
  const s = (raw.settings ?? {}) as Record<string, unknown>;
  const variants = (s.variants as AppState['profiles'][number]['settings']['variants']) ?? defProfile.settings.variants;
  const bp = (s.blockPage as AppState['profiles'][number]['settings']['blockPage']) ?? defProfile.settings.blockPage;

  const rawBlocks = Array.isArray(raw.blockList) ? (raw.blockList as Array<Record<string, unknown>>) : [];
  const blockList: BlockRule[] = rawBlocks.map((r) => {
    const opts = (r.options ?? {}) as Record<string, unknown>;
    const includeVariants = Boolean(opts.includeVariants ?? true);
    return {
      id: String(r.id ?? `br_mig_${Math.random().toString(36).slice(2, 8)}`),
      text: String(r.hostname ?? ''),
      matchMode: 'domain',
      domainOptions: {
        includeSubdomains: Boolean(opts.includeSubdomains ?? true),
        includeTldVariants: includeVariants,
        includeKnownMirrors: includeVariants,
      },
      patterns: Array.isArray(r.patterns) ? (r.patterns as string[]) : undefined,
      blockType: 'permanent',
      status: 'blocked',
      reason: String(r.reason ?? ''),
      createdAt: Number(r.createdAt ?? now),
    };
  });

  const rawWl = Array.isArray(raw.whitelist) ? (raw.whitelist as Array<Record<string, unknown>>) : [];
  const whitelist: WhitelistRule[] = rawWl.map((r) => ({
    id: String(r.id ?? `wl_mig_${Math.random().toString(36).slice(2, 8)}`),
    text: String(r.hostname ?? ''),
    matchMode: 'domain',
    patterns: Array.isArray(r.patterns) ? (r.patterns as string[]) : undefined,
    type: 'permanent',
    status: 'allowed',
    createdAt: Number(r.createdAt ?? now),
  }));

  // 旧的全局“固定允许时段”→ 迁移为白名单 schedule 条目（text='*'）
  const rawSchedules = Array.isArray(raw.schedules) ? (raw.schedules as Array<Record<string, unknown>>) : [];
  rawSchedules.forEach((sch, i) => {
    whitelist.push({
      id: `wl_mig_sch_${i}`,
      text: '*',
      matchMode: 'domain',
      type: 'schedule',
      schedule: {
        days: Array.isArray(sch.days) ? (sch.days as number[]) : [],
        startMin: Number(sch.startMin ?? 0),
        endMin: Number(sch.endMin ?? 0),
      },
      status: 'allowed',
      createdAt: now,
    });
  });

  const oldPassword = (s.password ?? {}) as { enabled?: boolean; hash?: string; salt?: string };
  const oldSync = (s.sync ?? def.sync) as AppState['sync'];

  const profile: Profile = {
    id: 'prof_default',
    name: '默认',
    blockList,
    whitelist,
    keywords: [],
    settings: {
      variants,
      blockPage: {
        title: String(bp.title ?? defProfile.settings.blockPage.title),
        message: String(bp.message ?? defProfile.settings.blockPage.message),
        type: 'message',
        redirectUrl: '',
        autoCloseSeconds: 0,
        showCountdown: Boolean(bp.showCountdown ?? true),
        defaultCountdownMs: Number(bp.defaultCountdownMs ?? 30 * 60 * 1000),
      },
      whitelistMode: false,
      keywordBlockingEnabled: false,
      silentMode: false,
    },
  };

  return {
    ...def,
    profiles: [profile],
    activeProfileId: 'prof_default',
    lockEnabled: typeof s.lockEnabled === 'boolean' ? s.lockEnabled : def.lockEnabled,
    password: { enabled: Boolean(oldPassword.enabled), hash: oldPassword.hash, salt: oldPassword.salt },
    sync: oldSync,
    sessionUnlocks: Array.isArray(raw.sessionUnlocks) ? (raw.sessionUnlocks as AppState['sessionUnlocks']) : [],
    activeCountdowns: Array.isArray(raw.activeCountdowns) ? (raw.activeCountdowns as AppState['activeCountdowns']) : [],
  };
}

function ensureProfile(p: Profile): Profile {
  const defProfile = defaultState().profiles[0]!;
  return {
    ...p,
    settings: {
      variants: { ...defProfile.settings.variants, ...(p.settings?.variants ?? {}) },
      blockPage: { ...defProfile.settings.blockPage, ...(p.settings?.blockPage ?? {}) },
      whitelistMode: p.settings?.whitelistMode ?? false,
      keywordBlockingEnabled: p.settings?.keywordBlockingEnabled ?? false,
      silentMode: p.settings?.silentMode ?? false,
    },
  };
}

function migrate(raw: unknown): AppState {
  const def = defaultState();
  const r = (raw ?? {}) as Record<string, unknown>;

  const hasV1 = r.version === 1 || (!Array.isArray(r.profiles) && Array.isArray(r.blockList));
  if (hasV1) return migrateV1(r);

  const rawProfiles = Array.isArray(r.profiles) ? (r.profiles as Profile[]) : [];
  const profiles = (rawProfiles.length > 0 ? rawProfiles : def.profiles).map(ensureProfile);
  const requestedActive = typeof r.activeProfileId === 'string' ? r.activeProfileId : null;
  const activeProfileId = profiles.some((p) => p.id === requestedActive) ? requestedActive! : profiles[0]!.id;

  const oldPassword = (r.password ?? {}) as Partial<AppState['password']>;
  const oldSecurity = (r.security ?? {}) as Partial<AppState['security']>;
  const oldSync = (r.sync ?? {}) as Partial<AppState['sync']>;
  const oldPomodoro = (r.pomodoro ?? {}) as Partial<AppState['pomodoro']>;

  return {
    ...def,
    ...r,
    version: STATE_VERSION,
    profiles,
    activeProfileId,
    password: { ...def.password, ...oldPassword },
    security: { ...def.security, ...oldSecurity },
    sync: { ...def.sync, ...oldSync },
    pomodoro: { ...def.pomodoro, ...oldPomodoro },
    theme: r.theme === 'dark' ? 'dark' : 'light',
    cooldownMinutes: typeof r.cooldownMinutes === 'number' ? r.cooldownMinutes : 0,
    cooldownUntil: typeof r.cooldownUntil === 'number' ? r.cooldownUntil : null,
    attemptResetDay: typeof r.attemptResetDay === 'string' ? r.attemptResetDay : dateKey(),
    pomodoroDay: typeof r.pomodoroDay === 'string' ? r.pomodoroDay : dateKey(),
  };
}

export async function loadState(): Promise<AppState> {
  const result = await browser.storage.local.get(STATE_KEY);
  return migrate(result[STATE_KEY]);
}

export async function saveState(state: AppState): Promise<void> {
  await browser.storage.local.set({ [STATE_KEY]: state });
}

/** 读取-修改-写回（单写者模型，扩展内可接受） */
export async function updateState(
  updater: (state: AppState) => AppState | Promise<AppState>,
): Promise<AppState> {
  const state = await loadState();
  const next = await updater(state);
  await saveState(next);
  return next;
}

/** 重置为默认状态 */
export async function resetState(): Promise<AppState> {
  const state = defaultState();
  await saveState(state);
  return state;
}

/** 计算 domain 模式规则的模式（供添加/更新） */
export function rulePatterns(text: string, opts?: BlockRule['domainOptions']): string[] {
  return computePatterns(text, opts);
}

/** 仅供测试：直接执行迁移 */
export function _migrateForTest(raw: unknown): AppState {
  return migrate(raw);
}

/** 若跨天则重置番茄会话计数 */
export function resetPomodoroDayIfNewDay(state: AppState, now: number = Date.now()): AppState {
  const key = dateKey(now);
  if (state.pomodoroDay === key) return state;
  return {
    ...state,
    pomodoroDay: key,
    pomodoro: { ...state.pomodoro, sessionsCompleted: 0 },
  };
}

/** 清除某域名的会话级临时放行与倒计时（重新添加/删除拦截时调用，避免旧放行覆盖新规则） */
export function clearHostGrants(state: AppState, host: string): AppState {
  const h = normalizeHost(host);
  return {
    ...state,
    sessionUnlocks: state.sessionUnlocks.filter((x) => normalizeHost(x.hostname) !== h),
    activeCountdowns: state.activeCountdowns.filter((c) => normalizeHost(c.hostname) !== h),
  };
}

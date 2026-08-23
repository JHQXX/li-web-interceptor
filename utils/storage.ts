/**
 * chrome.storage.local 封装：读取/保存/更新整个 AppState。
 */
import { browser } from 'wxt/browser';
import type { AppState } from './types';
import { STATE_VERSION } from './types';

const STATE_KEY = 'liwi:state:v1';

export function defaultState(): AppState {
  return {
    version: STATE_VERSION,
    blockList: [],
    whitelist: [],
    schedules: [],
    sessionUnlocks: [],
    activeCountdowns: [],
    settings: {
      lockEnabled: true,
      password: { enabled: false },
      blockPage: {
        title: '该网站已被拦截',
        message: '专注当前任务，完成后再回来。',
        showCountdown: true,
        defaultCountdownMs: 30 * 60 * 1000,
      },
      variants: {
        includeSubdomains: true,
        includeTldVariants: true,
        includeKnownMirrors: true,
      },
      sync: { provider: 'none', enabled: false, lastSyncAt: null, lastError: null },
    },
  };
}

function migrate(raw: unknown): AppState {
  const def = defaultState();
  const r = (raw ?? {}) as Partial<AppState>;
  const settings = { ...def.settings, ...(r.settings ?? {}) };
  return {
    ...def,
    ...r,
    version: STATE_VERSION,
    settings,
  } as AppState;
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

/** 清理过期的会话放行与倒计时 */
export function pruneState(state: AppState, now: number = Date.now()): AppState {
  const next = { ...state };
  next.sessionUnlocks = state.sessionUnlocks.filter((s) => s.expiresAt > now);
  next.activeCountdowns = state.activeCountdowns.filter((c) => c.unlocksAt > now);
  return next;
}

/** 重置为默认状态 */
export async function resetState(): Promise<AppState> {
  const state = defaultState();
  await saveState(state);
  return state;
}

/** 供非扩展环境（测试）注入存储后端 */
export function _setStorageBackend(backend: Pick<typeof browser.storage.local, 'get' | 'set'>) {
  (browser.storage.local as unknown as { get: unknown; set: unknown }).get = backend.get;
  (browser.storage.local as unknown as { get: unknown; set: unknown }).set = backend.set;
}

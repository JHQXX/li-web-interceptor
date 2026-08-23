/**
 * 数据快照：导出/导入（也是未来付费同步的数据格式）。
 * 快照有意排除：密码哈希（用户重新设置）、同步凭据。
 */
import type { AppState } from './types';
import { STATE_VERSION } from './types';

export interface SyncSnapshot {
  kind: 'liwi-snapshot';
  version: number;
  exportedAt: number;
  data: {
    blockList: AppState['blockList'];
    whitelist: AppState['whitelist'];
    schedules: AppState['schedules'];
    settings: {
      lockEnabled: boolean;
      blockPage: AppState['settings']['blockPage'];
      variants: AppState['settings']['variants'];
    };
  };
}

export function buildSnapshot(state: AppState): SyncSnapshot {
  return {
    kind: 'liwi-snapshot',
    version: STATE_VERSION,
    exportedAt: Date.now(),
    data: {
      blockList: state.blockList,
      whitelist: state.whitelist,
      schedules: state.schedules,
      settings: {
        lockEnabled: state.settings.lockEnabled,
        blockPage: state.settings.blockPage,
        variants: state.settings.variants,
      },
    },
  };
}

/** 校验快照结构是否合法 */
export function isSnapshot(x: unknown): x is SyncSnapshot {
  if (!x || typeof x !== 'object') return false;
  const s = x as SyncSnapshot;
  return (
    s.kind === 'liwi-snapshot' &&
    typeof s.version === 'number' &&
    Array.isArray(s.data?.blockList) &&
    Array.isArray(s.data?.whitelist) &&
    Array.isArray(s.data?.schedules)
  );
}

/** 应用快照到当前状态（保留本地密码与同步配置） */
export function applySnapshot(state: AppState, snap: SyncSnapshot): AppState {
  const next: AppState = {
    ...state,
    blockList: snap.data.blockList,
    whitelist: snap.data.whitelist,
    schedules: snap.data.schedules,
    settings: {
      ...state.settings,
      lockEnabled: snap.data.settings.lockEnabled,
      blockPage: snap.data.settings.blockPage,
      variants: snap.data.settings.variants,
    },
  };
  return next;
}

export function serializeSnapshot(snap: SyncSnapshot): string {
  return JSON.stringify(snap, null, 2);
}

export function parseSnapshot(json: string): SyncSnapshot {
  const parsed: unknown = JSON.parse(json);
  if (!isSnapshot(parsed)) throw new Error('不是有效的拦截器数据文件');
  return parsed;
}

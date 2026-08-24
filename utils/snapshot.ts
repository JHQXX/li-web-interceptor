/**
 * 数据快照：导出/导入（也是未来同步的数据格式）。
 * 快照有意排除：密码/安全问题哈希、同步凭据、历史与临时状态。
 */
import type { AppState, Profile } from './types';
import { STATE_VERSION } from './types';

export interface SyncSnapshot {
  kind: 'liwi-snapshot';
  version: number;
  exportedAt: number;
  data: {
    profiles: Profile[];
    activeProfileId: string;
    lockEnabled: boolean;
    cooldownMinutes: number;
    theme: AppState['theme'];
    lang: AppState['lang'];
    historyEnabled: boolean;
  };
}

export function buildSnapshot(state: AppState): SyncSnapshot {
  return {
    kind: 'liwi-snapshot',
    version: STATE_VERSION,
    exportedAt: Date.now(),
    data: {
      profiles: state.profiles,
      activeProfileId: state.activeProfileId,
      lockEnabled: state.lockEnabled,
      cooldownMinutes: state.cooldownMinutes,
      theme: state.theme,
      lang: state.lang,
      historyEnabled: state.historyEnabled,
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
    Array.isArray(s.data?.profiles) &&
    Array.isArray(s.data?.profiles[0]?.blockList)
  );
}

/** 应用快照（保留本地密码/安全问题/同步配置/历史/临时状态） */
export function applySnapshot(state: AppState, snap: SyncSnapshot): AppState {
  return {
    ...state,
    profiles: snap.data.profiles,
    activeProfileId: snap.data.activeProfileId,
    lockEnabled: snap.data.lockEnabled,
    cooldownMinutes: snap.data.cooldownMinutes,
    theme: snap.data.theme,
    lang: snap.data.lang,
    historyEnabled: snap.data.historyEnabled,
  };
}

export function serializeSnapshot(snap: SyncSnapshot): string {
  return JSON.stringify(snap, null, 2);
}

export function parseSnapshot(json: string): SyncSnapshot {
  const parsed: unknown = JSON.parse(json);
  if (!isSnapshot(parsed)) throw new Error('不是有效的拦截器数据文件');
  return parsed;
}

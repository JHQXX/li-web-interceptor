import type { SyncConfigInput, SyncProvider, SyncResult } from './types';
import type { SyncSnapshot } from '@/utils/snapshot';

const NOT_OPEN = 'WebDAV 同步为付费功能，尚未开放';

export const webdavProvider: SyncProvider = {
  id: 'webdav',
  label: 'WebDAV',
  async test(_config: SyncConfigInput): Promise<SyncResult> {
    return { ok: false, error: NOT_OPEN };
  },
  async push(_config: SyncConfigInput, _snapshot: SyncSnapshot): Promise<SyncResult> {
    return { ok: false, error: NOT_OPEN };
  },
  async pull(_config: SyncConfigInput): Promise<SyncResult> {
    return { ok: false, error: NOT_OPEN };
  },
};

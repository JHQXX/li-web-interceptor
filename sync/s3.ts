import type { SyncConfigInput, SyncProvider, SyncResult } from './types';
import type { SyncSnapshot } from '@/utils/snapshot';

const NOT_OPEN = 'S3 同步为付费功能，尚未开放';

export const s3Provider: SyncProvider = {
  id: 's3',
  label: 'S3',
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

/**
 * 付费同步（后开）接口定义。
 */
import type { SyncSnapshot } from '@/utils/snapshot';

export type SyncProviderId = 'webdav' | 's3';

/** 用户填写的存储配置（凭据字段后开时加密存储） */
export interface SyncConfigInput {
  provider: SyncProviderId;
  endpoint?: string;
  bucket?: string;
  path?: string;
  username?: string;
  password?: string;
  accessKey?: string;
  secretKey?: string;
  region?: string;
  [key: string]: unknown;
}

export interface SyncResult {
  ok: boolean;
  error?: string;
  snapshot?: SyncSnapshot;
}

export interface SyncProvider {
  readonly id: SyncProviderId;
  readonly label: string;
  /** 校验配置连通性 */
  test(config: SyncConfigInput): Promise<SyncResult>;
  /** 上传数据快照 */
  push(config: SyncConfigInput, snapshot: SyncSnapshot): Promise<SyncResult>;
  /** 拉取数据快照 */
  pull(config: SyncConfigInput): Promise<SyncResult>;
}

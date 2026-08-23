/**
 * 付费同步注册表。isPaidSyncEnabled 为特性开关，后开时翻转并实现各 Provider。
 */
import type { SyncProvider } from './types';
import { webdavProvider } from './webdav';
import { s3Provider } from './s3';

/** 付费同步总开关（后开） */
export const PAID_SYNC_ENABLED = false;

export const syncProviders: SyncProvider[] = [webdavProvider, s3Provider];

export function getSyncProvider(id: string): SyncProvider | undefined {
  return syncProviders.find((p) => p.id === id);
}

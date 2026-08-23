/**
 * 付费同步注册表。已实现（WebDAV / S3，免费）。
 */
import type { SyncProvider } from './types';
import { webdavProvider } from './webdav';
import { s3Provider } from './s3';

export const syncProviders: SyncProvider[] = [webdavProvider, s3Provider];

export function getSyncProvider(id: string): SyncProvider | undefined {
  return syncProviders.find((p) => p.id === id);
}

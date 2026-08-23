/**
 * WebDAV 同步：PUT/GET JSON 快照，可选 Basic 认证。
 */
import type { SyncConfigInput, SyncProvider, SyncResult } from './types';
import type { SyncSnapshot } from '@/utils/snapshot';
import { parseSnapshot } from '@/utils/snapshot';

export function fullUrl(cfg: SyncConfigInput): string {
  const base = (cfg.endpoint || '').trim().replace(/\/+$/, '');
  const path = (cfg.path || 'liwi-sync.json').trim().replace(/^\/+/, '');
  return `${base}/${path}`;
}

function authHeaders(cfg: SyncConfigInput): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.username != null && cfg.username !== '') {
    h.Authorization = 'Basic ' + btoa(`${cfg.username}:${cfg.password ?? ''}`);
  }
  return h;
}

export const webdavProvider: SyncProvider = {
  id: 'webdav',
  label: 'WebDAV',
  async test(cfg: SyncConfigInput): Promise<SyncResult> {
    try {
      const res = await fetch(fullUrl(cfg), { method: 'HEAD', headers: authHeaders(cfg) });
      // 404/405 也视为端点可达
      if (res.ok || res.status === 404 || res.status === 405) return { ok: true };
      return { ok: false, error: `${res.status} ${res.statusText}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
  async push(cfg: SyncConfigInput, snapshot: SyncSnapshot): Promise<SyncResult> {
    try {
      const res = await fetch(fullUrl(cfg), { method: 'PUT', headers: authHeaders(cfg), body: JSON.stringify(snapshot) });
      if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
  async pull(cfg: SyncConfigInput): Promise<SyncResult> {
    try {
      const res = await fetch(fullUrl(cfg), { method: 'GET', headers: authHeaders(cfg) });
      if (!res.ok) {
        if (res.status === 404) return { ok: false, error: 'remote-empty' };
        return { ok: false, error: `${res.status} ${res.statusText}` };
      }
      const text = await res.text();
      const snapshot = parseSnapshot(text);
      return { ok: true, snapshot };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};

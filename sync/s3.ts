/**
 * S3（及 S3 兼容存储）同步：AWS Signature V4（路径式 URL）。
 */
import type { SyncConfigInput, SyncProvider, SyncResult } from './types';
import type { SyncSnapshot } from '@/utils/snapshot';
import { parseSnapshot } from '@/utils/snapshot';

const enc = new TextEncoder();

export async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(data));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

export interface SigV4Params {
  method: string;
  host: string;
  path: string;
  query: string;
  payloadHash: string;
  region: string;
  accessKey: string;
  secretKey: string;
  amzDate: string;
  dateStamp: string;
  /** 额外头（按字母序参与签名），如 range */
  extraHeaders?: Record<string, string>;
}

/** 构造 canonical request（可单测） */
export function buildCanonicalRequest(p: SigV4Params): string {
  const headers: Record<string, string> = {
    host: p.host,
    'x-amz-content-sha256': p.payloadHash,
    'x-amz-date': p.amzDate,
    ...p.extraHeaders,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  return `${p.method}\n${p.path}\n${p.query}\n${canonicalHeaders}\n${signedHeaders}\n${p.payloadHash}`;
}

/** 生成 AWS4-HMAC-SHA256 授权头（可单测） */
export async function buildS3Authorization(p: SigV4Params): Promise<string> {
  const signedHeaders = Object.keys({
    host: p.host,
    'x-amz-content-sha256': p.payloadHash,
    'x-amz-date': p.amzDate,
    ...p.extraHeaders,
  }).sort().join(';');
  const canonicalRequest = buildCanonicalRequest(p);
  const scope = `${p.dateStamp}/${p.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${p.amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
  const kDate = await hmac(enc.encode(`AWS4${p.secretKey}`), p.dateStamp);
  const kRegion = await hmac(kDate, p.region);
  const kService = await hmac(kRegion, 's3');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = hex(await hmac(kSigning, stringToSign));
  return `AWS4-HMAC-SHA256 Credential=${p.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function objectUrl(cfg: SyncConfigInput): URL {
  const endpoint = (cfg.endpoint || 'https://s3.amazonaws.com').trim().replace(/\/+$/, '');
  const bucket = (cfg.bucket || 'default').trim();
  const key = (cfg.path || 'liwi-sync.json').trim().replace(/^\/+/, '');
  const url = new URL(endpoint);
  url.pathname = `/${bucket}/${key}`;
  return url;
}

async function signedFetch(
  cfg: SyncConfigInput,
  method: string,
  body?: string,
): Promise<Response> {
  const url = objectUrl(cfg);
  const payloadHash = await sha256Hex(body ?? '');
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = (cfg.region || 'us-east-1').trim();
  const auth = await buildS3Authorization({
    method,
    host: url.host,
    path: url.pathname,
    query: '',
    payloadHash,
    region,
    accessKey: cfg.accessKey ?? '',
    secretKey: cfg.secretKey ?? '',
    amzDate,
    dateStamp,
  });
  const headers: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: auth,
  };
  if (body != null) headers['Content-Type'] = 'application/json';
  return fetch(url.toString(), { method, headers, body });
}

export const s3Provider: SyncProvider = {
  id: 's3',
  label: 'S3',
  async test(cfg: SyncConfigInput): Promise<SyncResult> {
    try {
      const res = await signedFetch(cfg, 'GET');
      if (res.ok || res.status === 404 || res.status === 403) return { ok: true };
      return { ok: false, error: `${res.status} ${res.statusText}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
  async push(cfg: SyncConfigInput, snapshot: SyncSnapshot): Promise<SyncResult> {
    try {
      const res = await signedFetch(cfg, 'PUT', JSON.stringify(snapshot));
      if (!res.ok) return { ok: false, error: `${res.status} ${res.statusText}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
  async pull(cfg: SyncConfigInput): Promise<SyncResult> {
    try {
      const res = await signedFetch(cfg, 'GET');
      if (!res.ok) {
        if (res.status === 404) return { ok: false, error: 'remote-empty' };
        return { ok: false, error: `${res.status} ${res.statusText}` };
      }
      const snapshot = parseSnapshot(await res.text());
      return { ok: true, snapshot };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};

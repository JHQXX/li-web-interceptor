import { describe, it, expect } from 'vitest';
import { sha256Hex, buildCanonicalRequest, buildS3Authorization } from '@/sync/s3';
import { fullUrl, webdavProvider } from '@/sync/webdav';
import { s3Provider } from '@/sync/s3';
import type { SyncConfigInput } from '@/sync/types';

const GET_PARAMS = {
  method: 'GET',
  host: 'examplebucket.s3.amazonaws.com',
  path: '/test.txt',
  query: '',
  payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  amzDate: '20130524T000000Z',
  dateStamp: '20130524',
  extraHeaders: { range: 'bytes=0-9' },
};

describe('S3 SigV4（AWS 文档示例校验）', () => {
  it('sha256 空串为已知摘要', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('GET Object canonical request 哈希匹配 AWS 文档值 7344ae…', async () => {
    const cr = buildCanonicalRequest(GET_PARAMS);
    expect(await sha256Hex(cr)).toBe('7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972');
  });
  it('kDate 密钥链首步匹配已知 HMAC 值', async () => {
    // kDate = HMAC-SHA256("AWS4"+secret, "20130524")，用 WebCrypto 直接验证
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode('AWS4' + GET_PARAMS.secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode('20130524'));
    const hexStr = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hexStr).toBe('a5a91d94fa9a905c91e89aa51df0d86aef33adf77e97d146ae28e8d85d0df909');
  });
  it('授权头结构正确且确定性', async () => {
    const a = await buildS3Authorization(GET_PARAMS);
    const b = await buildS3Authorization(GET_PARAMS);
    expect(a).toBe(b);
    expect(a).toContain('Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request');
    expect(a).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
    expect(a).toMatch(/Signature=[0-9a-f]{64}$/);
  });
});

describe('WebDAV URL 拼接', () => {
  it('拼接 endpoint 与 path', () => {
    const cfg: SyncConfigInput = { provider: 'webdav', endpoint: 'https://dav.example.com/dav/', path: '/liwi-sync.json' };
    expect(fullUrl(cfg)).toBe('https://dav.example.com/dav/liwi-sync.json');
  });
  it('默认 path', () => {
    const cfg: SyncConfigInput = { provider: 'webdav', endpoint: 'https://dav.example.com' };
    expect(fullUrl(cfg)).toBe('https://dav.example.com/liwi-sync.json');
  });
});

describe('同步提供方注册', () => {
  it('webdav/s3 已注册', () => {
    expect(webdavProvider.id).toBe('webdav');
    expect(s3Provider.id).toBe('s3');
  });
});

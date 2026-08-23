import { describe, it, expect } from 'vitest';
import { generatePassword, hashPassword, verifyPassword, encryptText, decryptText } from '@/utils/crypto';

describe('generatePassword', () => {
  it('生成指定长度且只含允许字符', () => {
    const pwd = generatePassword(16);
    expect(pwd).toHaveLength(16);
    expect(pwd).toMatch(/^[A-Za-z0-9!@#$%^&*]+$/);
  });
  it('每次生成不同', () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});

describe('hashPassword / verifyPassword', () => {
  it('正确密码通过校验', async () => {
    const { hash, salt } = await hashPassword('secret123');
    expect(await verifyPassword('secret123', hash, salt)).toBe(true);
  });
  it('错误密码不通过', async () => {
    const { hash, salt } = await hashPassword('secret123');
    expect(await verifyPassword('wrong', hash, salt)).toBe(false);
  });
  it('相同盐可复现哈希', async () => {
    const a = await hashPassword('pw', 'fixed-salt');
    const b = await hashPassword('pw', 'fixed-salt');
    expect(a.hash).toBe(b.hash);
  });
});

describe('encryptText / decryptText', () => {
  it('roundtrip', async () => {
    const enc = await encryptText('master-secret', 's3-secret-key');
    expect(enc).not.toContain('s3-secret-key');
    expect(await decryptText('master-secret', enc)).toBe('s3-secret-key');
  });
  it('错误密钥解密失败', async () => {
    const enc = await encryptText('a', 'data');
    await expect(decryptText('b', enc)).rejects.toThrow();
  });
});

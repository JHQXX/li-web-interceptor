import { describe, it, expect } from 'vitest';
import { normalizeHost, getHostname, getRegistrableDomain } from '@/utils/domain';

describe('normalizeHost', () => {
  it('去掉协议与路径', () => {
    expect(normalizeHost('https://www.youtube.com/watch?v=abc')).toBe('youtube.com');
  });
  it('去掉 www 前缀', () => {
    expect(normalizeHost('WWW.Example.COM')).toBe('example.com');
  });
  it('去掉端口', () => {
    expect(normalizeHost('example.com:8080/x')).toBe('example.com');
  });
});

describe('getHostname', () => {
  it('解析合法 URL', () => {
    expect(getHostname('https://sub.example.com/path')).toBe('sub.example.com');
  });
  it('非法 URL 返回 null', () => {
    expect(getHostname('not a url')).toBeNull();
  });
});

describe('getRegistrableDomain', () => {
  it('普通域名', () => {
    expect(getRegistrableDomain('www.youtube.com')).toBe('youtube.com');
  });
  it('复合公共后缀', () => {
    expect(getRegistrableDomain('a.example.co.uk')).toBe('example.co.uk');
  });
  it('多级子域', () => {
    expect(getRegistrableDomain('a.b.example.com')).toBe('example.com');
  });
});

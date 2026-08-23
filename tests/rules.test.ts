import { describe, it, expect } from 'vitest';
import { matchesHost, anyMatch, expandHost, findRule, decideHost } from '@/utils/rules';
import type { BlockRule, WhitelistRule, Schedule, SessionUnlock, ActiveCountdown } from '@/utils/types';

const blockRule = (hostname: string, patterns: string[], extra: Partial<BlockRule> = {}): BlockRule => ({
  id: 'b1',
  hostname,
  patterns,
  options: { includeSubdomains: true, includeVariants: true, countdownMs: 30 * 60000 },
  reason: '',
  createdAt: 0,
  ...extra,
});

const wlRule = (hostname: string, patterns: string[]): WhitelistRule => ({
  id: 'w1',
  hostname,
  patterns,
  createdAt: 0,
});

const input = (over: Partial<{
  blockList: BlockRule[];
  whitelist: WhitelistRule[];
  schedules: Schedule[];
  sessionUnlocks: SessionUnlock[];
  activeCountdowns: ActiveCountdown[];
}> = {}) => ({
  blockList: [],
  whitelist: [],
  schedules: [],
  sessionUnlocks: [],
  activeCountdowns: [],
  ...over,
});

describe('matchesHost', () => {
  it('精确匹配', () => {
    expect(matchesHost('example.com', 'example.com')).toBe(true);
    expect(matchesHost('example.com', 'other.com')).toBe(false);
  });
  it('通配匹配含裸域', () => {
    expect(matchesHost('example.com', '*.example.com')).toBe(true);
    expect(matchesHost('a.example.com', '*.example.com')).toBe(true);
    expect(matchesHost('other.com', '*.example.com')).toBe(false);
  });
  it('大小写不敏感', () => {
    expect(matchesHost('EXAMPLE.COM', 'example.com')).toBe(true);
  });
});

describe('expandHost', () => {
  it('默认包含子域与镜像', () => {
    const p = expandHost('youtube.com', { includeSubdomains: true, includeTldVariants: true, includeKnownMirrors: true });
    expect(p).toContain('youtube.com');
    expect(p).toContain('*.youtube.com');
    expect(p).toContain('youtu.be');
  });
  it('关闭镜像则不含', () => {
    const p = expandHost('youtube.com', { includeSubdomains: false, includeTldVariants: false, includeKnownMirrors: false });
    expect(p).toEqual(['youtube.com']);
  });
  it('去 www', () => {
    const p = expandHost('www.reddit.com', { includeSubdomains: true, includeTldVariants: false, includeKnownMirrors: true });
    expect(p).toContain('reddit.com');
    expect(p).toContain('redd.it');
  });
});

describe('findRule', () => {
  it('最具体规则优先', () => {
    const rules = [
      blockRule('example.com', ['example.com', '*.example.com']),
      blockRule('sub.example.com', ['sub.example.com', '*.sub.example.com']),
    ];
    expect(findRule('deep.sub.example.com', rules)?.hostname).toBe('sub.example.com');
  });
});

describe('decideHost', () => {
  it('未拦截时放行', () => {
    expect(decideHost('example.com', input()).status).toBe('allowed');
  });
  it('命中拦截列表则拦截', () => {
    const d = decideHost('youtube.com', input({ blockList: [blockRule('youtube.com', ['youtube.com', '*.youtube.com'])] }));
    expect(d.status).toBe('blocked');
  });
  it('子域命中通配拦截', () => {
    const d = decideHost('m.youtube.com', input({ blockList: [blockRule('youtube.com', ['youtube.com', '*.youtube.com'])] }));
    expect(d.status).toBe('blocked');
  });
  it('白名单优先于拦截', () => {
    const d = decideHost('mail.google.com', input({
      blockList: [blockRule('google.com', ['google.com', '*.google.com'])],
      whitelist: [wlRule('mail.google.com', ['mail.google.com', '*.mail.google.com'])],
    }));
    expect(d.status).toBe('allowed');
    expect(d.cause).toBe('whitelist');
  });
  it('允许时段优先于拦截', () => {
    const now = new Date(2026, 0, 4, 12, 0).getTime();
    const d = decideHost('youtube.com', input({
      blockList: [blockRule('youtube.com', ['youtube.com'])],
      schedules: [{ id: 's', days: [], startMin: 9 * 60, endMin: 18 * 60, enabled: true }],
    }), now);
    expect(d.status).toBe('allowed');
    expect(d.cause).toBe('schedule');
  });
  it('会话放行优先于拦截', () => {
    const now = Date.now();
    const d = decideHost('youtube.com', input({
      blockList: [blockRule('youtube.com', ['youtube.com'])],
      sessionUnlocks: [{ id: 'u', hostname: 'youtube.com', expiresAt: now + 60000 }],
    }), now);
    expect(d.status).toBe('allowed');
    expect(d.cause).toBe('session');
  });
  it('倒计时中仍拦截并返回剩余时间', () => {
    const now = Date.now();
    const d = decideHost('youtube.com', input({
      blockList: [blockRule('youtube.com', ['youtube.com'])],
      activeCountdowns: [{ id: 'c', hostname: 'youtube.com', unlocksAt: now + 60_000 }],
    }), now);
    expect(d.status).toBe('blocked');
    if (d.status === 'blocked') expect(d.countdownRemainingMs).toBe(60_000);
  });
  it('倒计时到期后放行', () => {
    const now = Date.now();
    const d = decideHost('youtube.com', input({
      blockList: [blockRule('youtube.com', ['youtube.com'])],
      activeCountdowns: [{ id: 'c', hostname: 'youtube.com', unlocksAt: now - 1000 }],
    }), now);
    expect(d.status).toBe('allowed');
    expect(d.cause).toBe('countdown-done');
  });
  it('anyMatch 生效', () => {
    expect(anyMatch('a.example.com', ['example.com', '*.example.com'])).toBe(true);
    expect(anyMatch('other.com', ['example.com'])).toBe(false);
  });
});

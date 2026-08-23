import { describe, it, expect } from 'vitest';
import {
  matchesHost,
  anyMatch,
  expandHost,
  modeMatches,
  patternToRegex,
  findBlockRule,
  findKeyword,
  decide,
} from '@/utils/rules';
import type { BlockRule, WhitelistRule, TimeWindow } from '@/utils/types';

const mkRule = (over: Partial<BlockRule> = {}): BlockRule => ({
  id: 'b1',
  text: 'youtube.com',
  matchMode: 'domain',
  blockType: 'permanent',
  status: 'blocked',
  reason: '',
  createdAt: 0,
  ...over,
});

const mkWl = (over: Partial<WhitelistRule> = {}): WhitelistRule => ({
  id: 'w1',
  text: 'mail.google.com',
  matchMode: 'domain',
  type: 'permanent',
  status: 'allowed',
  createdAt: 0,
  ...over,
});

const mkTime = (day: number, h: number, m: number) => {
  const d = new Date(2026, 0, 4);
  d.setDate(d.getDate() + day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

const baseInput = () => ({
  blockList: [],
  whitelist: [],
  keywords: [],
  keywordBlockingEnabled: false,
  whitelistMode: false,
  sessionUnlocks: [],
  activeCountdowns: [],
  activeTimewise: {} as Record<string, number>,
  attemptState: {} as Record<string, number>,
  whitelistAttemptState: {} as Record<string, number>,
});

describe('matchesHost / expandHost', () => {
  it('通配含裸域', () => {
    expect(matchesHost('a.example.com', '*.example.com')).toBe(true);
    expect(matchesHost('example.com', '*.example.com')).toBe(true);
    expect(matchesHost('other.com', '*.example.com')).toBe(false);
  });
  it('衍生扩展含子域与镜像', () => {
    const p = expandHost('youtube.com', { includeSubdomains: true, includeTldVariants: true, includeKnownMirrors: true });
    expect(p).toContain('youtube.com');
    expect(p).toContain('*.youtube.com');
    expect(p).toContain('youtu.be');
  });
  it('anyMatch', () => {
    expect(anyMatch('sub.example.com', ['*.example.com'])).toBe(true);
  });
});

describe('modeMatches', () => {
  it('domain 命中子域', () => {
    const rule = mkRule({ matchMode: 'domain', text: 'youtube.com', patterns: ['youtube.com', '*.youtube.com'] });
    expect(modeMatches('https://m.youtube.com/x', 'm.youtube.com', rule)).toBe(true);
  });
  it('contain 命中关键字任意位置', () => {
    const rule = mkRule({ matchMode: 'contain', text: 'shop' });
    expect(modeMatches('https://anothershop.com/a', 'anothershop.com', rule)).toBe(true);
    expect(modeMatches('https://x.com', 'x.com', rule)).toBe(false);
  });
  it('exact 命中精确域名（忽略 www）', () => {
    const rule = mkRule({ matchMode: 'exact', text: 'example.com' });
    expect(modeMatches('https://www.example.com/', 'www.example.com', rule)).toBe(true);
    expect(modeMatches('https://a.example.com/', 'a.example.com', rule)).toBe(false);
  });
  it('full 命中完整 URL', () => {
    const rule = mkRule({ matchMode: 'full', text: 'https://shop.com/a' });
    expect(modeMatches('https://shop.com/a', 'shop.com', rule)).toBe(true);
    expect(modeMatches('https://shop.com/b', 'shop.com', rule)).toBe(false);
  });
  it('pattern 通配', () => {
    expect(patternToRegex('https://shop.com/*/checkout/').test('https://shop.com/user1/checkout/')).toBe(true);
    const rule = mkRule({ matchMode: 'pattern', text: 'https://shop.com/*/checkout/' });
    expect(modeMatches('https://shop.com/u/checkout/', 'shop.com', rule)).toBe(true);
  });
  it('通配 * 匹配一切', () => {
    const rule = mkRule({ matchMode: 'domain', text: '*' });
    expect(modeMatches('https://anything.com', 'anything.com', rule)).toBe(true);
  });
});

describe('findKeyword', () => {
  it('命中启用的关键字', () => {
    expect(findKeyword('https://video.example.com', [{ keyword: 'video', enabled: true }])).toBe('video');
  });
  it('跳过禁用关键字', () => {
    expect(findKeyword('https://video.example.com', [{ keyword: 'video', enabled: false }])).toBeUndefined();
  });
});

describe('decide - 优先级', () => {
  it('未命中放行', () => {
    expect(decide('https://ok.com', 'ok.com', baseInput()).status).toBe('allowed');
  });
  it('永久拦截', () => {
    const d = decide('https://youtube.com', 'youtube.com', {
      ...baseInput(),
      blockList: [mkRule()],
    });
    expect(d.status).toBe('blocked');
    if (d.status === 'blocked') expect(d.cause).toBe('rule');
  });
  it('会话放行优先于拦截', () => {
    const now = Date.now();
    const d = decide('https://youtube.com', 'youtube.com', {
      ...baseInput(),
      blockList: [mkRule()],
      sessionUnlocks: [{ id: 'u', hostname: 'youtube.com', expiresAt: now + 60000 }],
    }, now);
    expect(d.status).toBe('allowed');
    expect(d.cause).toBe('session');
  });
  it('白名单优先于拦截', () => {
    const d = decide('https://mail.google.com', 'mail.google.com', {
      ...baseInput(),
      blockList: [mkRule({ text: 'google.com', patterns: ['google.com', '*.google.com'] })],
      whitelist: [mkWl()],
    });
    expect(d.status).toBe('allowed');
    expect(d.cause).toBe('whitelist');
  });
  it('全站白名单模式拦截未白名单站点', () => {
    const d = decide('https://youtube.com', 'youtube.com', {
      ...baseInput(),
      whitelistMode: true,
    });
    expect(d.status).toBe('blocked');
    if (d.status === 'blocked') expect(d.cause).toBe('allowlist');
  });
  it('关键词拦截优先于规则', () => {
    const d = decide('https://news.example.com', 'news.example.com', {
      ...baseInput(),
      keywordBlockingEnabled: true,
      keywords: [{ keyword: 'news', enabled: true }],
    });
    expect(d.status).toBe('blocked');
    if (d.status === 'blocked') expect(d.cause).toBe('keyword');
  });
});

describe('decide - 拦截类型', () => {
  it('attemptwise 未达次数放行并返回 ruleId', () => {
    const rule = mkRule({ blockType: 'attemptwise', attempts: 5 });
    const d = decide('https://youtube.com', 'youtube.com', {
      ...baseInput(),
      blockList: [rule],
      attemptState: { b1: 2 },
    });
    expect(d.status).toBe('allowed');
    if (d.status === 'allowed') {
      expect(d.cause).toBe('attempt-allowed');
      expect(d.ruleId).toBe('b1');
    }
  });
  it('attemptwise 达到次数后拦截', () => {
    const rule = mkRule({ blockType: 'attemptwise', attempts: 5 });
    const d = decide('https://youtube.com', 'youtube.com', {
      ...baseInput(),
      blockList: [rule],
      attemptState: { b1: 5 },
    });
    expect(d.status).toBe('blocked');
  });
  it('timewise 计时中拦截，计时结束后放行', () => {
    const rule = mkRule({ blockType: 'timewise', durationMs: 60000 });
    const now = Date.now();
    const blocked = decide('https://youtube.com', 'youtube.com', {
      ...baseInput(),
      blockList: [rule],
      activeTimewise: { b1: now + 30000 },
    }, now);
    expect(blocked.status).toBe('blocked');
    const expired = decide('https://youtube.com', 'youtube.com', {
      ...baseInput(),
      blockList: [rule],
      activeTimewise: { b1: now - 1000 },
    }, now);
    expect(expired.status).toBe('allowed');
  });
  it('schedule 时段内拦截、时段外放行', () => {
    const rule = mkRule({ blockType: 'schedule', schedule: { days: [], startMin: 9 * 60, endMin: 18 * 60 } as TimeWindow });
    const inside = decide('https://youtube.com', 'youtube.com', { ...baseInput(), blockList: [rule] }, mkTime(0, 12, 0));
    expect(inside.status).toBe('blocked');
    const outside = decide('https://youtube.com', 'youtube.com', { ...baseInput(), blockList: [rule] }, mkTime(0, 20, 0));
    expect(outside.status).toBe('allowed');
  });
  it('倒计时中返回剩余毫秒', () => {
    const now = Date.now();
    const d = decide('https://youtube.com', 'youtube.com', {
      ...baseInput(),
      blockList: [mkRule()],
      activeCountdowns: [{ id: 'c', hostname: 'youtube.com', unlocksAt: now + 60000 }],
    }, now);
    expect(d.status).toBe('blocked');
    if (d.status === 'blocked') expect(d.countdownRemainingMs).toBe(60000);
  });
});

describe('decide - 白名单类型', () => {
  it('attemptwise 白名单有额度放行，耗尽后拦截', () => {
    const wl = mkWl({ text: 'youtube.com', type: 'attemptwise', attempts: 3 });
    const allowed = decide('https://youtube.com', 'youtube.com', {
      ...baseInput(),
      whitelist: [wl],
      whitelistAttemptState: { w1: 1 },
    });
    expect(allowed.status).toBe('allowed');
    const exhausted = decide('https://youtube.com', 'youtube.com', {
      ...baseInput(),
      blockList: [mkRule()],
      whitelist: [wl],
      whitelistAttemptState: { w1: 3 },
    });
    expect(exhausted.status).toBe('blocked');
  });
  it('schedule 白名单时段内放行、时段外拦截', () => {
    const wl = mkWl({ text: '*', type: 'schedule', schedule: { days: [], startMin: 9 * 60, endMin: 18 * 60 } });
    const inside = decide('https://x.com', 'x.com', { ...baseInput(), whitelist: [wl] }, mkTime(0, 10, 0));
    expect(inside.status).toBe('allowed');
    const outside = decide('https://x.com', 'x.com', { ...baseInput(), blockList: [mkRule({ text: 'x.com' })], whitelist: [wl] }, mkTime(0, 20, 0));
    expect(outside.status).toBe('blocked');
  });
});

describe('findBlockRule', () => {
  it('只匹配 status=blocked 的规则', () => {
    const on = mkRule({ id: 'a' });
    const off = mkRule({ id: 'b', status: 'unblocked' });
    expect(findBlockRule('https://youtube.com', 'youtube.com', [off, on])?.id).toBe('a');
    expect(findBlockRule('https://youtube.com', 'youtube.com', [off])).toBeUndefined();
  });
});

import { computePatterns } from '@/utils/rules';

describe('默认只拦当前域名（衍生扩展全关）', () => {
  it('全关时只生成精确域名模式', () => {
    const p = computePatterns('youtube.com', { includeSubdomains: false, includeTldVariants: false, includeKnownMirrors: false });
    expect(p).toEqual(['youtube.com']);
    expect(p).not.toContain('*.youtube.com');
    expect(p).not.toContain('youtu.be');
  });
  it('开启子域时加入通配', () => {
    const p = computePatterns('youtube.com', { includeSubdomains: true, includeTldVariants: false, includeKnownMirrors: false });
    expect(p).toContain('*.youtube.com');
    expect(p).not.toContain('youtu.be');
  });
});

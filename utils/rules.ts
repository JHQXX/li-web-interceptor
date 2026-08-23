/**
 * 规则引擎：匹配、衍生扩展、拦截判定（纯函数，可单测）。
 */
import type { AppState, BlockRule, Schedule, SessionUnlock, ActiveCountdown } from './types';
import { COMMON_TLDS, getRegistrableDomain, normalizeHost } from './domain';
import { isInSchedule } from './time';

export type Decision =
  | { status: 'allowed'; cause: 'not-listed' | 'whitelist' | 'schedule' | 'session' | 'countdown-done' }
  | { status: 'blocked'; cause: 'rule'; rule: BlockRule; countdownRemainingMs: number | null };

/** 主机名匹配：支持 "*.example.com" 通配（含裸域） */
export function matchesHost(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return h === base || h.endsWith('.' + base);
  }
  return h === p;
}

export function anyMatch(host: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesHost(host, p));
}

/** 已知知名网站的镜像/替代域名字典 */
export const KNOWN_MIRRORS: Record<string, string[]> = {
  'youtube.com': ['youtu.be', 'youtube-nocookie.com'],
  'reddit.com': ['redd.it', 'redditmedia.com'],
  'twitter.com': ['x.com'],
  'x.com': ['twitter.com'],
  'instagram.com': ['instagr.am'],
  'tiktok.com': ['tiktokv.com'],
  'bilibili.com': ['b23.tv'],
  'douyin.com': ['iesdouyin.com'],
  'weibo.com': ['weibo.cn'],
  'spotify.com': ['spotify.link'],
  'netflix.com': ['nflxvideo.net'],
  'steampowered.com': ['steamcommunity.com'],
  'twitch.tv': ['jtvnw.net'],
  'taobao.com': ['tmall.com'],
  '163.com': ['126.com', 'yeah.net'],
};

/** 把用户添加的域名展开为匹配模式列表（衍生网站） */
export function expandHost(
  host: string,
  opts: { includeSubdomains: boolean; includeTldVariants: boolean; includeKnownMirrors: boolean },
): string[] {
  const h = normalizeHost(host);
  if (!h) return [];
  const patterns = new Set<string>([h]);
  if (opts.includeSubdomains) patterns.add('*.' + h);
  if (opts.includeTldVariants) {
    const reg = getRegistrableDomain(h);
    if (reg && reg.includes('.')) {
      const name = reg.slice(0, reg.lastIndexOf('.'));
      for (const tld of COMMON_TLDS) {
        patterns.add(`${name}.${tld}`);
        if (opts.includeSubdomains) patterns.add(`*.${name}.${tld}`);
      }
    }
  }
  if (opts.includeKnownMirrors) {
    const key = getRegistrableDomain(h) ?? h;
    const mirrors = KNOWN_MIRRORS[key] ?? KNOWN_MIRRORS[h] ?? [];
    for (const m of mirrors) {
      patterns.add(m);
      if (opts.includeSubdomains) patterns.add('*.' + m);
    }
  }
  return [...patterns];
}

/** 找到最具体的命中规则（精确模式优先于通配） */
export function findRule(host: string, rules: BlockRule[]): BlockRule | undefined {
  let best: { rule: BlockRule; score: number } | undefined;
  for (const rule of rules) {
    for (const p of rule.patterns) {
      if (matchesHost(host, p)) {
        const score = p.startsWith('*.') ? p.length - 1 : p.length + 1000;
        if (!best || score > best.score) best = { rule, score };
      }
    }
  }
  return best?.rule;
}

export interface DecideInput {
  blockList: BlockRule[];
  whitelist: AppState['whitelist'];
  schedules: Schedule[];
  sessionUnlocks: SessionUnlock[];
  activeCountdowns: ActiveCountdown[];
}

/**
 * 拦截判定。优先级：白名单 > 允许时段 > 会话放行 > 倒计时 > 拦截列表。
 */
export function decideHost(host: string, input: DecideInput, now: number = Date.now()): Decision {
  const h = host.toLowerCase();
  // 会话放行与倒计时按“去 www 的规范化域名”匹配，避免 www. 与裸域对不上
  const hNorm = normalizeHost(h);

  // 1. 白名单（最高优先）
  if (input.whitelist.some((r) => anyMatch(h, r.patterns))) {
    return { status: 'allowed', cause: 'whitelist' };
  }
  // 2. 固定允许时段
  if (isInSchedule(input.schedules, now)) {
    return { status: 'allowed', cause: 'schedule' };
  }
  // 3. 会话级临时放行
  if (input.sessionUnlocks.some((s) => s.hostname === hNorm && s.expiresAt > now)) {
    return { status: 'allowed', cause: 'session' };
  }
  // 4/5. 拦截列表 + 倒计时
  const rule = findRule(h, input.blockList);
  if (rule) {
    const cd = input.activeCountdowns.find((c) => c.hostname === hNorm);
    if (cd) {
      if (cd.unlocksAt <= now) {
        return { status: 'allowed', cause: 'countdown-done' };
      }
      return {
        status: 'blocked',
        cause: 'rule',
        rule,
        countdownRemainingMs: cd.unlocksAt - now,
      };
    }
    return { status: 'blocked', cause: 'rule', rule, countdownRemainingMs: null };
  }
  return { status: 'allowed', cause: 'not-listed' };
}

/**
 * 规则引擎 v2：匹配模式、拦截类型、白名单模式、关键词、按次/计时/排程（纯函数，可单测）。
 */
import type {
  BlockPageSettings,
  BlockRule,
  SessionUnlock,
  ActiveCountdown,
  DomainOptions,
  WhitelistRule,
} from './types';
import { COMMON_TLDS, getRegistrableDomain, normalizeHost } from './domain';
import { isInWindow } from './time';

export type Decision =
  | {
      status: 'allowed';
      cause: 'session' | 'whitelist' | 'countdown-done' | 'not-listed' | 'attempt-allowed';
      ruleId?: string;
      whitelistRuleId?: string;
    }
  | {
      status: 'blocked';
      cause: 'rule' | 'keyword' | 'allowlist';
      rule?: BlockRule;
      keyword?: string;
      countdownRemainingMs: number | null;
      silent: boolean;
    };

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

/** 计算 domain 模式的匹配模式（供添加/更新时缓存到规则） */
export function computePatterns(text: string, opts?: DomainOptions): string[] {
  const h = normalizeHost(text);
  if (!h) return [text];
  const o = opts ?? { includeSubdomains: true, includeTldVariants: false, includeKnownMirrors: true };
  return expandHost(h, o);
}

/** 通配模式转正则（* → 任意字符） */
export function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

interface Matchable {
  text: string;
  matchMode: BlockRule['matchMode'];
  domainOptions?: DomainOptions;
  patterns?: string[];
}

/** 按匹配模式判断 URL/主机是否命中 */
export function modeMatches(url: string, host: string, rule: Matchable): boolean {
  const text = rule.text.trim().toLowerCase();
  if (text === '*') return true;
  switch (rule.matchMode) {
    case 'domain': {
      const patterns = rule.patterns ?? computePatterns(text, rule.domainOptions);
      return anyMatch(host, patterns);
    }
    case 'contain':
      return url.toLowerCase().includes(text);
    case 'exact':
      return normalizeHost(host) === normalizeHost(text);
    case 'full':
      return url.toLowerCase() === text;
    case 'pattern':
      return patternToRegex(text).test(url.toLowerCase());
    default:
      return false;
  }
}

export function findBlockRule(url: string, host: string, rules: BlockRule[]): BlockRule | undefined {
  for (const rule of rules) {
    if (rule.status !== 'blocked') continue;
    if (modeMatches(url, host, rule)) return rule;
  }
  return undefined;
}

export function findWhitelistRule(url: string, host: string, rules: WhitelistRule[]): WhitelistRule | undefined {
  for (const rule of rules) {
    if (rule.status !== 'allowed') continue;
    if (modeMatches(url, host, rule)) return rule;
  }
  return undefined;
}

export function findKeyword(url: string, keywords: { keyword: string; enabled: boolean }[]): string | undefined {
  const u = url.toLowerCase();
  for (const k of keywords) {
    if (!k.enabled) continue;
    const kw = k.keyword.trim().toLowerCase();
    if (kw && u.includes(kw)) return kw;
  }
  return undefined;
}

export interface DecideInput {
  blockList: BlockRule[];
  whitelist: WhitelistRule[];
  keywords: { keyword: string; enabled: boolean }[];
  keywordBlockingEnabled: boolean;
  whitelistMode: boolean;
  sessionUnlocks: SessionUnlock[];
  activeCountdowns: ActiveCountdown[];
  activeTimewise: Record<string, number>;
  attemptState: Record<string, number>;
  whitelistAttemptState: Record<string, number>;
  now?: number;
}

/**
 * 拦截判定。优先级：会话放行 > 白名单 > 全站白名单模式 > 关键词 > 拦截规则 > 放行。
 */
export function decide(
  url: string,
  host: string,
  input: DecideInput,
  now: number = Date.now(),
): Decision {
  const hNorm = normalizeHost(host);

  // 1. 会话级临时放行
  if (input.sessionUnlocks.some((s) => s.hostname === hNorm && s.expiresAt > now)) {
    return { status: 'allowed', cause: 'session' };
  }

  // 2. 白名单
  const wl = findWhitelistRule(url, host, input.whitelist);
  if (wl) {
    if (wl.type === 'permanent') {
      return { status: 'allowed', cause: 'whitelist', whitelistRuleId: wl.id };
    }
    if (wl.type === 'schedule' && wl.schedule && isInWindow(wl.schedule, now)) {
      return { status: 'allowed', cause: 'whitelist', whitelistRuleId: wl.id };
    }
    if (wl.type === 'attemptwise') {
      const used = input.whitelistAttemptState[wl.id] ?? 0;
      const total = wl.attempts ?? 0;
      if (total > 0 && used < total) {
        return { status: 'allowed', cause: 'whitelist', whitelistRuleId: wl.id };
      }
    }
  }

  // 3. 全站白名单模式
  if (input.whitelistMode) {
    return { status: 'blocked', cause: 'allowlist', countdownRemainingMs: null, silent: false };
  }

  // 4. 关键词拦截
  if (input.keywordBlockingEnabled) {
    const kw = findKeyword(url, input.keywords);
    if (kw) {
      return { status: 'blocked', cause: 'keyword', keyword: kw, countdownRemainingMs: null, silent: false };
    }
  }

  // 5. 拦截规则
  const rule = findBlockRule(url, host, input.blockList);
  if (rule) {
    // 会话倒计时（定时解锁）
    const cd = input.activeCountdowns.find((c) => c.hostname === hNorm);
    if (cd) {
      if (cd.unlocksAt <= now) {
        return { status: 'allowed', cause: 'countdown-done' };
      }
      return { status: 'blocked', cause: 'rule', rule, countdownRemainingMs: cd.unlocksAt - now, silent: false };
    }
    // 按类型
    if (rule.blockType === 'permanent') {
      return { status: 'blocked', cause: 'rule', rule, countdownRemainingMs: null, silent: false };
    }
    if (rule.blockType === 'schedule') {
      if (rule.schedule && isInWindow(rule.schedule, now)) {
        return { status: 'blocked', cause: 'rule', rule, countdownRemainingMs: null, silent: false };
      }
      return { status: 'allowed', cause: 'not-listed' };
    }
    if (rule.blockType === 'timewise') {
      const until = input.activeTimewise[rule.id];
      if (until != null && until <= now) {
        return { status: 'allowed', cause: 'not-listed' };
      }
      return {
        status: 'blocked',
        cause: 'rule',
        rule,
        countdownRemainingMs: until != null ? until - now : null,
        silent: false,
      };
    }
    if (rule.blockType === 'attemptwise') {
      const used = input.attemptState[rule.id] ?? 0;
      const total = rule.attempts ?? 0;
      if (total > 0 && used < total) {
        return { status: 'allowed', cause: 'attempt-allowed', ruleId: rule.id };
      }
      return { status: 'blocked', cause: 'rule', rule, countdownRemainingMs: null, silent: false };
    }
    // 兜底：永久
    return { status: 'blocked', cause: 'rule', rule, countdownRemainingMs: null, silent: false };
  }

  // 6. 无规则命中
  return { status: 'allowed', cause: 'not-listed' };
}

/** 由规则与全局拦截页设置计算最终重定向目标 */
export function resolveBlockTarget(
  rule: BlockRule | undefined,
  blockPage: BlockPageSettings,
  blockedPageUrl: string,
): string {
  if (rule?.redirectUrl) return rule.redirectUrl;
  if (blockPage.type === 'redirect' && blockPage.redirectUrl) return blockPage.redirectUrl;
  return blockedPageUrl;
}

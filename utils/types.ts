/**
 * 全局类型定义：存储 schema、消息协议等。
 */

export type SyncProviderId = 'none' | 'webdav' | 's3';

/** 拦截规则：一个用户添加的网站（含扩展出的衍生模式） */
export interface BlockRule {
  id: string;
  /** 用户输入的规范化域名，如 "youtube.com" */
  hostname: string;
  /** 展开后的匹配模式列表，如 ["youtube.com","*.youtube.com","youtu.be"] */
  patterns: string[];
  options: {
    /** 是否拦截所有子域名 */
    includeSubdomains: boolean;
    /** 是否拦截常见 TLD 变体与镜像域名 */
    includeVariants: boolean;
    /** 默认倒计时（毫秒），null 表示不自动倒计时 */
    countdownMs: number | null;
  };
  /** 拦截时展示的原因/说明 */
  reason: string;
  createdAt: number;
}

/** 白名单规则 */
export interface WhitelistRule {
  id: string;
  hostname: string;
  patterns: string[];
  createdAt: number;
}

/** 固定允许时段（全局，作用于所有被拦截站点） */
export interface Schedule {
  id: string;
  /** 0=周日 … 6=周六；空数组表示每天 */
  days: number[];
  /** 开始分钟（0-1439） */
  startMin: number;
  /** 结束分钟（0-1439），小于 startMin 表示跨午夜 */
  endMin: number;
  enabled: boolean;
}

/** 会话级临时放行 */
export interface SessionUnlock {
  id: string;
  hostname: string;
  expiresAt: number;
}

/** 倒计时解锁（到期自动放行） */
export interface ActiveCountdown {
  id: string;
  hostname: string;
  unlocksAt: number;
}

export interface PasswordSettings {
  enabled: boolean;
  /** PBKDF2 哈希（hex） */
  hash?: string;
  /** 哈希盐 */
  salt?: string;
}

export interface BlockPageSettings {
  title: string;
  message: string;
  showCountdown: boolean;
  /** 默认倒计时时长（毫秒），用于“倒计时解锁” */
  defaultCountdownMs: number;
}

/** 新规则的衍生扩展默认值 */
export interface VariantSettings {
  includeSubdomains: boolean;
  includeTldVariants: boolean;
  includeKnownMirrors: boolean;
}

/** 付费同步（后开）预留配置 */
export interface SyncSettings {
  provider: SyncProviderId;
  enabled: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface Settings {
  /** 总开关：关闭后不拦截任何网站 */
  lockEnabled: boolean;
  password: PasswordSettings;
  blockPage: BlockPageSettings;
  variants: VariantSettings;
  sync: SyncSettings;
}

export interface AppState {
  version: number;
  blockList: BlockRule[];
  whitelist: WhitelistRule[];
  schedules: Schedule[];
  sessionUnlocks: SessionUnlock[];
  activeCountdowns: ActiveCountdown[];
  settings: Settings;
}

export const STATE_VERSION = 1;

/**
 * 全局类型定义：v2 存储 schema、消息协议等。
 */

export type SyncProviderId = 'none' | 'webdav' | 's3';

/** 匹配模式：domain=衍生扩展域名 / contain=包含关键字 / exact=精确域名 / pattern=通配 / full=全URL精确 */
export type MatchMode = 'domain' | 'contain' | 'exact' | 'pattern' | 'full';
/** 拦截类型 */
export type BlockType = 'permanent' | 'timewise' | 'attemptwise' | 'schedule';
/** 白名单类型 */
export type WhitelistType = 'permanent' | 'attemptwise' | 'schedule';
export type Theme = 'light' | 'dark' | 'auto';
/** 语言：auto=跟随浏览器 / zh / en */
export type Lang = 'auto' | 'zh' | 'en';
export type RuleStatus = 'blocked' | 'unblocked';
export type AllowStatus = 'allowed' | 'not-allowed';

/** 时段：days 0=周日…6=周六，空=每天；endMin<startMin 表示跨午夜 */
export interface TimeWindow {
  days: number[];
  startMin: number;
  endMin: number;
}

export interface DomainOptions {
  includeSubdomains: boolean;
  includeTldVariants: boolean;
  includeKnownMirrors: boolean;
}

/** 拦截规则 */
export interface BlockRule {
  id: string;
  /** 用户输入原文：域名 / 关键字 / URL / 通配（* 表示全部） */
  text: string;
  matchMode: MatchMode;
  /** domain 模式下的衍生扩展开关 */
  domainOptions?: DomainOptions;
  /** domain 模式展开后的主机模式（缓存） */
  patterns?: string[];
  blockType: BlockType;
  /** attemptwise：访问 N 次后拦截 */
  attempts?: number;
  /** timewise：拦截时长（毫秒） */
  durationMs?: number | null;
  /** schedule：按星期+时段拦截 */
  schedule?: TimeWindow;
  /** 规则开关，不删除 */
  status: RuleStatus;
  /** 规则级覆盖重定向 URL */
  redirectUrl?: string;
  /** 拦截时展示的原因 */
  reason: string;
  createdAt: number;
}

/** 白名单规则 */
export interface WhitelistRule {
  id: string;
  text: string;
  matchMode: MatchMode;
  domainOptions?: DomainOptions;
  patterns?: string[];
  type: WhitelistType;
  /** attemptwise：每日允许 N 次 */
  attempts?: number;
  /** schedule：按星期+时段放行 */
  schedule?: TimeWindow;
  status: AllowStatus;
  createdAt: number;
}

export interface KeywordRule {
  id: string;
  keyword: string;
  enabled: boolean;
}

export type HistoryAction = 'blocked' | 'silent' | 'keyword' | 'allowlist';

export interface HistoryEntry {
  id: string;
  at: number;
  url: string;
  host: string;
  label: string;
  action: HistoryAction;
}

export interface VariantSettings {
  includeSubdomains: boolean;
  includeTldVariants: boolean;
  includeKnownMirrors: boolean;
}

export interface BlockPageSettings {
  title: string;
  message: string;
  /** 命中后展示内置拦截页（message）还是重定向到 redirectUrl */
  type: 'message' | 'redirect';
  redirectUrl: string;
  /** 拦截页 N 秒后自动关闭（0=不自动关闭） */
  autoCloseSeconds: number;
  showCountdown: boolean;
  /** 拦截页“定时解锁”默认时长（毫秒） */
  defaultCountdownMs: number;
}

/** 每个档案独立的配置与数据 */
export interface ProfileSettings {
  variants: VariantSettings;
  blockPage: BlockPageSettings;
  /** 全站白名单模式：除白名单外全拦截 */
  whitelistMode: boolean;
  keywordBlockingEnabled: boolean;
  /** 静默拦截：命中后直接关闭标签页 */
  silentMode: boolean;
}

export interface Profile {
  id: string;
  name: string;
  blockList: BlockRule[];
  whitelist: WhitelistRule[];
  keywords: KeywordRule[];
  settings: ProfileSettings;
}

export interface PasswordSettings {
  enabled: boolean;
  hash?: string;
  salt?: string;
}

/** 安全问题找回密码 */
export interface SecuritySettings {
  question: string;
  answerHash?: string;
  answerSalt?: string;
}

/** 同步（免费）配置；凭据以 AES-GCM 加密存储 */
export interface SyncSettings {
  provider: SyncProviderId;
  enabled: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  /** AES-GCM 加密的配置 JSON */
  configEnc?: string;
  /** 加密密钥 */
  encKey?: string;
}

export type PomodoroStatus = 'idle' | 'focus' | 'break' | 'paused';

export interface PomodoroState {
  status: PomodoroStatus;
  focusMinutes: number;
  breakMinutes: number;
  totalCycles: number;
  cycleIndex: number;
  endTime: number | null;
  pausedRemaining: number | null;
  pausedFrom: 'focus' | 'break' | null;
  sessionsCompleted: number;
}

/** 会话级临时放行 */
export interface SessionUnlock {
  id: string;
  hostname: string;
  expiresAt: number;
}

/** 会话倒计时解锁（到期自动放行） */
export interface ActiveCountdown {
  id: string;
  hostname: string;
  unlocksAt: number;
}

export interface AppState {
  version: number;
  profiles: Profile[];
  activeProfileId: string;
  /** 总开关 */
  lockEnabled: boolean;
  /** 禁用冷却（分钟），关闭总开关后需等待才能重新开启 */
  cooldownMinutes: number;
  cooldownUntil: number | null;
  /** 临时暂停（防打扰）：该时间前放行所有网站，之后恢复 */
  pauseUntil: number | null;
  theme: Theme;
  lang: Lang;
  historyEnabled: boolean;
  password: PasswordSettings;
  security: SecuritySettings;
  sync: SyncSettings;
  pomodoro: PomodoroState;
  /** 番茄会话按天重置的日期（YYYY-MM-DD） */
  pomodoroDay: string;
  history: HistoryEntry[];
  sessionUnlocks: SessionUnlock[];
  activeCountdowns: ActiveCountdown[];
  /** ruleId → 解锁时间戳（timewise 拦截） */
  activeTimewise: Record<string, number>;
  /** blockRuleId → 今日已访问次数 */
  attemptState: Record<string, number>;
  /** whitelistRuleId → 今日已放行次数 */
  whitelistAttemptState: Record<string, number>;
  /** 按次计数按天重置的日期（YYYY-MM-DD） */
  attemptResetDay: string;
}

export const STATE_VERSION = 3;

/** 预设安全问题 */
export const SECURITY_QUESTIONS = [
  '你最喜欢的小学老师是谁？',
  '你第一次工作的城市是？',
  '你父亲最喜欢的爱好是什么？',
  '你第一部手机是什么品牌？',
  '你的宠物叫什么名字？',
  '你最喜欢的一本书的作者是谁？',
];

export const HISTORY_LIMIT = 500;

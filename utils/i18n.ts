/**
 * 多语言助手：包装 chrome.i18n.getMessage，失败时回退为 key。
 * 非扩展环境（单测）下浏览器 API 不可用时同样回退。
 */
import { browser } from 'wxt/browser';

// WXT 生成的 i18n 类型把 key 收窄为 __MSG_*__ 联合，这里放宽以支持任意 key
function rawGetMessage(key: string, subs?: string[]): string {
  const i18n = (browser as unknown as { i18n?: { getMessage(key: string, subs?: string[]): string } }).i18n;
  if (!i18n) return '';
  return i18n.getMessage(key, subs) ?? '';
}

export function t(key: string, subs?: Array<string | number>): string {
  try {
    const msg = rawGetMessage(key, subs?.map(String));
    return msg || key;
  } catch {
    return key;
  }
}

/** 星期几标签：0=周日 … 6=周六 */
export function weekdayLabel(day: number): string {
  const keys = ['daySun', 'dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat'];
  return t(keys[day] ?? 'daySun');
}

/** 带周前缀的星期标签，如 “周一” / “Mon” */
export function weekdayWithPrefix(day: number): string {
  return t('weekPrefix', [weekdayLabel(day)]);
}

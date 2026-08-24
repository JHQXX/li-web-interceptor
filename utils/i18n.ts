/**
 * 多语言助手：
 * - 内置中/英词典，可用 setLang 强制指定语言（不依赖浏览器 _locales 缓存）
 * - auto 时回退 chrome.i18n（浏览器语言），再兜底中文
 */
import { browser } from 'wxt/browser';
import zhDict from './messages-zh.json';
import enDict from './messages-en.json';
import type { Lang } from './types';

const zh = zhDict as unknown as Record<string, string>;
const en = enDict as unknown as Record<string, string>;

let override: Record<string, string> | null = null;
let currentLang: Lang = 'auto';

/** 指定语言（'auto' 表示跟随浏览器）。调用后 t() 立即生效。 */
export function setLang(lang: Lang): void {
  currentLang = lang;
  override = lang === 'en' ? en : lang === 'zh' ? zh : null;
}

export function getLang(): Lang {
  return currentLang;
}

function rawGetMessage(key: string, subs?: string[]): string {
  const i18n = (browser as unknown as { i18n?: { getMessage(key: string, subs?: string[]): string } }).i18n;
  if (!i18n) return '';
  return i18n.getMessage(key, subs) ?? '';
}

export function t(key: string, subs?: Array<string | number>): string {
  const s = subs?.map(String);
  let base = '';
  if (override && override[key]) {
    base = override[key];
  } else {
    try {
      base = rawGetMessage(key, s);
    } catch {
      // 忽略
    }
    if (!base) base = zh[key] ?? key;
  }
  if (s) {
    s.forEach((v, i) => {
      base = base.split(`$${i + 1}`).join(v);
    });
  }
  return base;
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

const MSG_RE = /__MSG_([A-Za-z0-9_]+)__/g;

function replaceIn(text: string): string {
  return text.replace(MSG_RE, (_, key: string) => t(key));
}

/** 运行时把 DOM 中所有 __MSG_key__ 占位符替换为本地化文案。 */
export function applyI18n(root: ParentNode = document): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const n of nodes) {
    if (n.textContent && n.textContent.includes('__MSG_')) {
      n.textContent = replaceIn(n.textContent);
    }
  }
  root.querySelectorAll<Element>('*').forEach((el) => {
    for (const attr of ['placeholder', 'title']) {
      const v = el.getAttribute(attr);
      if (v && v.includes('__MSG_')) el.setAttribute(attr, replaceIn(v));
    }
  });
}

/** 在 DOMContentLoaded 后再执行一次替换（兜底） */
export function applyI18nWhenReady(): void {
  if (document.readyState !== 'loading') {
    applyI18n();
    return;
  }
  document.addEventListener('DOMContentLoaded', () => applyI18n());
}

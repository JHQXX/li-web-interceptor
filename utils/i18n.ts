/**
 * 多语言助手：优先 chrome.i18n，缺失时回退到内置中文词典，保证文案始终可见。
 * 非扩展环境（单测）下同样安全回退为 key。
 */
import { browser } from 'wxt/browser';
import zhDict from './messages-zh.json';

const zh = zhDict as unknown as Record<string, string>;

// WXT 生成的 i18n 类型把 key 收窄为 __MSG_*__ 联合，这里放宽以支持任意 key
function rawGetMessage(key: string, subs?: string[]): string {
  const i18n = (browser as unknown as { i18n?: { getMessage(key: string, subs?: string[]): string } }).i18n;
  if (!i18n) return '';
  return i18n.getMessage(key, subs) ?? '';
}

export function t(key: string, subs?: Array<string | number>): string {
  const s = subs?.map(String);
  try {
    const msg = rawGetMessage(key, s);
    if (msg) return msg;
  } catch {
    // 忽略
  }
  // 内置中文兜底
  let base = zh[key] ?? key;
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

/**
 * 运行时把 DOM 中所有 __MSG_key__ 占位符替换为本地化文案（文本节点 + placeholder/title 属性）。
 * 不依赖 Chrome 对 HTML 的自动替换，兼容性更好。
 */
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

/** 在 DOMContentLoaded 后再执行一次替换（兜底，防止首次执行过早） */
export function applyI18nWhenReady(): void {
  if (document.readyState !== 'loading') {
    applyI18n();
    return;
  }
  document.addEventListener('DOMContentLoaded', () => applyI18n());
}

/**
 * 主题工具：支持 auto（跟随系统）。
 */
import type { Theme } from './types';

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'auto') {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }
  return theme;
}

/** 应用主题到 documentElement.dataset.theme；auto 时监听系统切换。返回清理函数。 */
export function applyTheme(theme: Theme): () => void {
  const apply = () => {
    document.documentElement.dataset.theme = resolveTheme(theme);
  };
  apply();
  let mql: MediaQueryList | null = null;
  if (theme === 'auto') {
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', apply);
    } catch {
      // 忽略
    }
  }
  return () => {
    try {
      mql?.removeEventListener('change', apply);
    } catch {
      // 忽略
    }
  };
}

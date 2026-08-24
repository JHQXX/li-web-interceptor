import { describe, it, expect, beforeEach } from 'vitest';
import { setLang, t } from '@/utils/i18n';
import { defaultState, _migrateForTest } from '@/utils/storage';

describe('i18n setLang', () => {
  beforeEach(() => setLang('auto'));
  it('en 时返回英文', () => {
    setLang('en');
    expect(t('appName')).toBe('LI Web Interceptor');
    expect(t('navBlockList')).toBe('Block List');
  });
  it('zh 时返回中文', () => {
    setLang('zh');
    expect(t('appName')).toBe('LI 网站拦截器');
    expect(t('navBlockList')).toBe('拦截列表');
  });
  it('auto 时至少不是裸 key', () => {
    setLang('auto');
    expect(t('appName')).not.toContain('__MSG_');
  });
  it('占位符替换 $1', () => {
    setLang('en');
    expect(t('popupBlockedCount', [3])).toBe('Blocked (3)');
  });
});

describe('lang 迁移与持久化', () => {
  it('migrate 保留 lang=en', () => {
    const s = defaultState();
    s.lang = 'en';
    expect(_migrateForTest(s).lang).toBe('en');
  });
  it('非法 lang 回退 auto', () => {
    const s = defaultState();
    (s as unknown as { lang: string }).lang = 'xx';
    expect(_migrateForTest(s).lang).toBe('auto');
  });
});

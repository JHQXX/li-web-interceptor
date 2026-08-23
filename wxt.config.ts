import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'LI 网站拦截器',
    description: '拦截指定网站：匹配模式、拦截类型、白名单、关键词、档案、番茄钟、统计、同步预留。',
    permissions: ['webNavigation', 'storage', 'contextMenus', 'activeTab', 'alarms', 'notifications'],
    omnibox: { keyword: 'bl' },
    commands: {
      'toggle-lock': {
        suggested_key: { default: 'Ctrl+Shift+L' },
        description: '开关网站拦截',
      },
      'block-tab': {
        suggested_key: { default: 'Ctrl+Shift+B' },
        description: '拦截当前网站',
      },
    },
  },
});

import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'LI 网站拦截器',
    description: '拦截指定网站：匹配模式、拦截类型、白名单、关键词、档案、番茄钟、同步预留。',
    permissions: ['webNavigation', 'storage', 'contextMenus', 'activeTab', 'alarms'],
  },
});

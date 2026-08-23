import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: 'LI 网站拦截器',
    description: '拦截指定网站，支持白名单、随机密码、定期解锁与衍生网站拦截。',
    permissions: ['webNavigation', 'storage', 'contextMenus', 'activeTab'],
  },
});

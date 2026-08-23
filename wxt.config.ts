import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    default_locale: 'zh_CN',
    name: '__MSG_appName__',
    description: '__MSG_appDesc__',
    permissions: ['webNavigation', 'storage', 'contextMenus', 'activeTab', 'alarms', 'notifications'],
    host_permissions: ['https://*/*', 'http://*/*'],
    omnibox: { keyword: 'bl' },
    commands: {
      'toggle-lock': {
        suggested_key: { default: 'Ctrl+Shift+L' },
        description: '__MSG_cmdToggleLock__',
      },
      'block-tab': {
        suggested_key: { default: 'Ctrl+Shift+B' },
        description: '__MSG_cmdBlockTab__',
      },
    },
  },
});

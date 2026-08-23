# LI 网站拦截器 (li-web-interceptor)

一个面向 Chromium（Chrome / Edge）的浏览器扩展（Manifest V3）：拦截你指定的网站，帮助你专注与自律。

## 功能

- **全屏拦截页**：访问被拦截网站时重定向到扩展内置的拦截页，展示网站名、原因与倒计时。
- **快速添加**：
  - 工具栏弹窗一键「拦截本站」；
  - 右键菜单「加入网站拦截器」/「拦截此链接的网站」；
  - 设置页手动添加域名。
- **白名单**：优先于拦截规则放行，支持精确域名与子域。
- **随机密码**：开启后修改拦截列表 / 提前解锁需输入密码；密码仅在生成时展示一次，忘记可重新生成（软性自律，浏览器限制下无法阻止用户卸载扩展）。
- **定期解锁**：
  - 倒计时解锁：拦截时可设置倒计时，到期自动放行；
  - 固定允许时段：设置每天重复的允许窗口（可跨午夜、按星期）。
- **衍生网站拦截**：添加域名时自动扩展拦截 `www`、所有子域名、常见 TLD 变体（`.com/.cn/.net` 等）与已知镜像站（如 `youtube.com ↔ youtu.be`），每条规则可单独开关。
- **数据管理**：一键导出 / 导入 JSON 数据快照、清空数据。
- **付费同步（后开）**：WebDAV / S3 同步已预留 `SyncProvider` 接口与配置面板，功能尚未开放（`sync/index.ts` 中 `PAID_SYNC_ENABLED = false`）。

## 技术栈

- [WXT](https://wxt.dev) + TypeScript + Vite（Manifest V3）
- 存储：`chrome.storage.local`
- 加密：WebCrypto（PBKDF2 密码哈希、AES-GCM 敏感字段）
- 测试：Vitest

## 开发

```bash
npm install
npm run dev        # 启动开发模式（HMR）
npm run build      # 生产构建 -> .output/chrome-mv3
npm run zip        # 构建并打包 zip
npm test           # 运行单元测试
npm run compile    # TypeScript 类型检查
```

### 在浏览器中加载

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）；
2. 开启「开发者模式」；
3. 点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3` 目录；
4. 浏览器上工具栏即可看到拦截器图标。

## 目录结构

```
entrypoints/
  background.ts        # 拦截逻辑、右键菜单、消息分发
  blocked/             # 全屏拦截页
  popup/               # 工具栏弹窗
  options/             # 设置页
utils/
  types.ts             # 存储 schema 与消息协议
  rules.ts             # 规则引擎（匹配/衍生/判定）
  domain.ts            # 域名解析
  time.ts              # 时段与倒计时
  crypto.ts            # 密码哈希与加密
  storage.ts           # chrome.storage 封装
  snapshot.ts          # 数据快照（导出/导入/同步数据格式）
  messaging.ts         # UI 与 background 通信
sync/
  types.ts             # SyncProvider 接口（后开）
  webdav.ts / s3.ts    # 付费同步桩实现
  index.ts             # 特性开关与提供方注册
```

## 已知限制

- 密码保护是软性自律机制：用户仍可通过卸载 / 禁用扩展绕过，这是浏览器对消费级扩展的固有限制。
- 付费同步（WebDAV / S3）为预留能力，待后续版本实现。

## License

MIT

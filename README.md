# LI 网站拦截器 (li-web-interceptor)

一个面向 Chromium（Chrome / Edge）的浏览器扩展（Manifest V3）：拦截指定网站，帮助你专注与自律。功能集参考 Extfy「Website Blocker」全量对齐，当前全部免费。

## 功能

### 拦截规则
- **匹配模式**：`域名+衍生`（自动扩展子域 / TLD 变体 / 已知镜像站，如 youtube.com ↔ youtu.be）、`包含关键字`、`精确域名`、`通配 *`、`全 URL 精确`。
- **拦截类型**：永久 / 计时（1·5·10·30·60 分钟或自定义）/ 按次（访问 N 次后拦截）/ 排程（按星期+时段）。
- 每条规则可单独开关（拦截中/暂停，不删除）、可单独设置重定向 URL。
- 快速添加：弹窗一键「拦截本站」（可选手动类型）、右键菜单、设置页。

### 白名单
- 类型：永久放行 / 按次放行（每日 N 次，跨天重置）/ 排程放行（按星期+时段）。
- **全站白名单模式**：开启后除白名单外全部拦截。

### 拦截页
- 全局「提示文案 **或** 重定向 URL」、N 秒后自动关闭；每条规则可覆盖重定向。
- 倒计时展示与「定时解锁」；随机密码解锁（仅展示一次、可重设），忘记密码可回答安全问题找回。

### 全局能力
- **关键词拦截**（任意 URL 包含关键字即拦截，可独立开关）。
- **静默拦截**（命中后直接关闭标签页）。
- **禁用冷却**（关闭总开关后需等待 N 分钟才能重新开启，0/1/5/10/30）。
- **多档案 Profiles**：多套独立档案（各自含拦截/白名单/关键词/设置），新建/继承/切换/删除。
- **番茄钟**：专注/休息循环、暂停/继续/停止、图标角标倒计时、每日会话统计。
- **历史记录**：记录被拦访问（时间/URL/命中方式），可开关、清空。
- **深色模式**、图标角标倒计时（计时拦截/番茄钟剩余分钟）。
- **统计面板**：今日拦截次数、按方式统计、被拦截 Top 网站、今日番茄会话（基于历史）。
- **预置模板**：一键添加「视频 / 社交 / 购物 / 资讯 / 游戏」常用分心网站。
- **列表搜索**：拦截列表、白名单、历史记录支持搜索过滤；历史可按方式筛选。
- **数据管理**：JSON 导出导入、拦截列表/白名单 CSV 导出、清空；重复添加同规则自动去重。
- **WebDAV / S3 同步**：把数据快照同步到你自己填写的存储空间（WebDAV PUT/GET、S3 及 S3 兼容存储，AWS Signature V4），支持测试连接 / 上传 / 下载，凭据 AES-GCM 加密存储。
- **多语言（i18n）**：`chrome.i18n` + `_locales`，内置简体中文（默认）与英文，随浏览器语言自动切换。

## 快捷操作
- **OmniBox**：地址栏输入 `bl` 后加空格，支持 `bl add youtube.com`（加入拦截）、`bl allow x.com`（加入白名单）、`bl on` / `bl off`（开关）、`bl list`（打开设置）。
- **快捷键**：`Ctrl/Cmd+Shift+L` 开关拦截，`Ctrl/Cmd+Shift+B` 拦截当前网站（可在 `chrome://extensions/shortcuts` 修改）。
- **番茄钟阶段切换**会发送系统通知。

## 技术栈
- [WXT](https://wxt.dev) + TypeScript + Vite（Manifest V3）
- 存储：`chrome.storage.local`（v2 多档案 schema，含 v1 自动迁移）
- 加密：WebCrypto（PBKDF2 密码/安全答案哈希、AES-GCM 敏感字段）
- 测试：Vitest

## 开发
```bash
npm install
npm run dev        # 开发模式（HMR）
npm run build      # 生产构建 -> .output/chrome-mv3
npm run zip        # 构建并打包 zip
npm test           # 单元测试
npm run compile    # TypeScript 类型检查
```

### 在浏览器中加载
1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）；
2. 开启「开发者模式」；
3. 点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3` 目录；
4. 首次加载会从旧版数据自动迁移。

## 目录结构
```
entrypoints/
  background.ts        # 统一拦截判定、静默/历史/alarms/角标/冷却/番茄
  blocked/             # 全屏拦截页（文案/重定向/倒计时/密码+安全问题）
  popup/               # 弹窗（快速拦截、番茄钟、全站白名单）
  options/             # 设置页（9 个 Tab）
utils/
  types.ts             # v2 存储 schema 与消息协议
  rules.ts             # 匹配引擎（模式/类型/白名单模式/关键词/按次/排程）
  storage.ts           # chrome.storage 封装、v1→v2 迁移、档案助手
  time.ts              # 时段与番茄钟状态机
  crypto.ts            # 密码/安全答案哈希与加密
  snapshot.ts          # 数据快照（导出/导入/同步数据格式）
  messaging.ts         # UI 与 background 通信
sync/
  webdav.ts / s3.ts    # 同步桩实现（后开）
  index.ts             # 特性开关与提供方注册
```

## 已知限制
- 密码与禁用冷却均为软性自律：用户仍可通过卸载 / 禁用扩展绕过，这是浏览器对消费级扩展的固有限制。
- WebDAV/S3 同步凭据仅加密存储于本机，请保管好存储账号；同步为“上传覆盖/下载替换”模型，下载前会二次确认。

## License
MIT

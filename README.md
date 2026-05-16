# Tabletop transfer station

一个可配置中转站地址的桌面余额监控工具，支持 Windows 和 macOS。应用常驻托盘/菜单栏，并提供可拖动、可缩放、自动吸附隐藏、鼠标靠近后滑出的桌面悬浮窗。

仓库地址：[https://github.com/Xhuiz/Tabletop-transfer-station](https://github.com/Xhuiz/Tabletop-transfer-station)

## 功能

- Windows 托盘 / macOS 菜单栏常驻
- 内置登录窗口，复用 Electron 本地会话
- 显示余额、订阅/额度、账号、邀请码、API Key 摘要
- 桌面悬浮窗支持拖动、缩放、边缘吸附隐藏和滑出
- 默认吸附桌面右上区域，只露出右侧中间的一小段把手
- 支持普通中转站接口路径覆盖
- 支持 Xiaomi MiMo Token Plan
- 支持 UCloud 渠道控制台类站点，例如 `https://console.compshare.cn`
- 支持 Windows NSIS 安装包和 macOS DMG

## 快速开始

```bash
npm install
npm start
```

首次启动或点击桌面快捷方式时，会先打开登录设置窗口。填入中转站 URL、账号和密码后，应用会保存 URL 到本地配置，并打开对应登录页尝试自动填表。账号和密码只用于本次登录填表，不会写入配置文件。

中转站 URL 通常填登录网站的首页域名，例如 `https://relay.example.com`。部分控制台页面也可以直接粘贴，例如 `https://console.compshare.cn/dashboard/wallet`，应用会自动识别并修正到对应域名。

## 已内置适配

- Xiaomi MiMo：填 `https://platform.xiaomimimo.com`，应用会使用 `/api/v1/tokenPlan/*` 相关接口。
- UCloud 渠道控制台：填 `https://console.compshare.cn` 或同类 `console.*` / `console-*` 控制台域名，应用会自动推断 `api.*` / `api-*` API 域，并通过 `GetBalance` Action 拉取余额。该类站点需要在内置登录窗口完成登录，应用会用同一个 Electron 会话携带 Cookie、CSRF 和 channel-key 请求余额接口。

## 配置中转站

最常见用法是只改 `baseUrl`：

```json
{
  "baseUrl": "https://your-relay.example.com"
}
```

如果中转站接口路径和默认路径不一致，可以覆盖单个 path：

```json
{
  "baseUrl": "https://your-relay.example.com",
  "paths": {
    "walletApi": "/api/wallet",
    "sessionApi": "/api/auth/session",
    "apiKeysApi": "/api/apikeys?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc",
    "profileApi": "/api/user/profile",
    "inviteInfoApi": "/api/user/invite/info",
    "login": "/login",
    "dashboardWallet": "/dashboard/wallet",
    "inviteRegister": "/register",
    "dashboardRscCandidates": ["/dashboard"]
  }
}
```

安装版启动后，也可以从托盘菜单点击“打开中转站配置文件”。用户级配置路径：

- Windows: `%APPDATA%\Tabletop transfer station\relay.config.json`
- macOS: `~/Library/Application Support/Tabletop transfer station/relay.config.json`

## 适配要求

普通中转站只要满足以下接口，通常可以直接使用：

- `GET /api/auth/session`
- `GET /api/wallet`
- `GET /api/apikeys?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc`
- `GET /api/user/profile`
- `GET /api/user/invite/info`
- `/login` 登录页
- `/dashboard/wallet` 钱包页

如果接口返回结构不同，需要在 `balanceSnapshot.js` 中补充解析逻辑；如果登录域、API 域或鉴权方式不同，建议新增独立 adapter，不要把站点逻辑散落到主流程里。

## 本地开发

```bash
npm install
npm test
npm start
```

## 打包

Windows:

```bash
npm run build:win
```

macOS:

```bash
npm run build:mac
```

产物位于 `dist/`。也可以在 GitHub Actions 手动运行 `Build desktop installers`，云端会分别生成 Windows 安装包和 macOS x64/arm64 DMG。未配置 Apple Developer 证书时，macOS 产物是未签名版本，首次打开可能需要在系统设置里手动允许。

国内网络环境构建 Electron 时，可以临时设置镜像：

```powershell
$env:NODE_OPTIONS='--use-system-ca'
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm run build:win
```

macOS/Linux shell:

```bash
export NODE_OPTIONS=--use-system-ca
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm run build:mac
```

## 安全说明

本工具只在本机保存 Electron 会话和本地配置，不会把账号、密码、Cookie、API Key 上传到第三方服务。登录设置窗口里的账号和密码只保存在当前进程内存中，用于打开登录页时自动填表。

## License

MIT

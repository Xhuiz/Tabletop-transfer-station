# Tabletop transfer station

一个可配置中转站地址的桌面余额监控工具，支持 Windows 和 macOS。应用会常驻托盘/菜单栏，并提供可拖动、可缩放、自动吸附隐藏、鼠标靠近后丝滑滑出的桌面悬浮窗。

默认配置使用占位域名 `https://relay.example.com`。本地部署后，把 `relay.config.json` 里的 `baseUrl` 改成你自己的中转站首页域名即可使用。登录设置窗口也可以直接粘贴控制台页面地址，应用会尽量自动提取正确域名。

仓库地址：[https://github.com/Xhuiz/Tabletop-transfer-station](https://github.com/Xhuiz/Tabletop-transfer-station)

## 功能

- Windows 托盘 / macOS 菜单栏常驻
- 内置登录窗口，复用 Electron 会话
- 显示总余额、订阅余额、按量余额、订阅计划和剩余天数
- 显示账号、邀请码、API Key 消耗摘要
- 一键复制邀请链接
- 可配置刷新频率
- 桌面悬浮窗支持拖动、缩放、自动吸附、边缘隐藏和丝滑滑出
- 默认吸附在桌面右上区域，只露出右上边缘中间的一小段把手
- 中转站地址可配置，支持覆盖单个接口路径
- 支持 Windows NSIS 安装包和 macOS DMG

## 快速开始

```bash
npm install
npm start
```

首次启动或点击桌面快捷方式时，会先打开本地登录设置窗口。填写中转站 URL、账号和密码后，应用会保存 URL 到本地配置，并打开中转站登录页尝试自动填表。账号和密码只用于本次登录填表，不会写入配置文件。

中转站 URL 通常填登录网站的首页域名，例如 `https://relay.example.com`，不要填写接口路径。部分站点的控制台地址也可以直接粘贴，应用会内置识别并修正。

登录完成后，托盘菜单和桌面悬浮窗会显示余额信息。

## 配置中转站

项目根目录提供两个配置文件：

- `relay.config.json`：应用默认读取的配置
- `relay.config.example.json`：示例配置

最常见用法是只改 `baseUrl`：

```json
{
  "baseUrl": "https://your-relay.example.com"
}
```

已内置适配：

- Xiaomi MiMo 平台：填写 `https://platform.xiaomimimo.com`，或粘贴该站控制台页面地址。应用会自动使用 `/api/v1/tokenPlan/*` 相关接口。

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
    "dashboardRscCandidates": [
      "/dashboard"
    ]
  }
}
```

安装版启动后，也可以从托盘菜单点击“打开中转站配置文件”。用户级配置路径会复制一份 `relay.config.json` 到应用数据目录：

- Windows: `%APPDATA%\Tabletop transfer station\relay.config.json`
- macOS: `~/Library/Application Support/Tabletop transfer station/relay.config.json`

配置优先级：

1. 用户数据目录里的 `relay.config.json`
2. 安装包内或项目根目录的 `relay.config.json`
3. 代码内置默认配置

修改配置后，退出并重新启动应用即可生效。

## 适配要求

大多数兼容中转站只要满足以下接口即可直接使用：

- `GET /api/auth/session`
- `GET /api/wallet`
- `GET /api/apikeys?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc`
- `GET /api/user/profile`
- `GET /api/user/invite/info`
- `GET /dashboard` 或等价 dashboard 页面，用于解析订阅到期时间
- `/login` 登录页
- `/dashboard/wallet` 钱包页

如果接口返回结构不兼容，需要在 `balanceSnapshot.js` 中适配解析逻辑。

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

产物位于 `dist/` 目录。

也可以在 GitHub 仓库的 Actions 页面手动运行 `Build desktop installers`，云端会分别生成 Windows 安装包和 macOS x64/arm64 DMG。未配置 Apple Developer 证书时，macOS 产物是未签名版本，首次打开可能需要在系统设置里手动允许。

在国内网络环境构建 Electron 时，可以临时设置镜像：

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

本工具只在本机保存 Electron 会话和本地配置，不会把账号、密码、Cookie、API Key 上传到第三方服务。登录设置窗口里的账号和密码只保存在当前进程内存中，用于打开登录页时自动填表。请只配置你信任的中转站域名。

## License

MIT

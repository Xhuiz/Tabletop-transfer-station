// Project: Tabletop transfer station (Electron)
const { app, BrowserWindow, Tray, Menu, session, nativeImage, shell, Notification, clipboard, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildRelayConfig, isPlaceholderRelayConfig } = require('./relayConfig');
const { buildBalanceSnapshot, hasSessionIdentity } = require('./balanceSnapshot');
const { isLikelyAuthCookieName } = require('./authCookie');
const {
  buildOverlayRows,
  getDefaultOverlayPlacement,
  getOverlayAnimationFrames,
  getOverlaySize,
  getOverlayShapeRects,
  getNearestOverlayEdge,
  getOverlayPosition,
  getOverlayMoveBounds,
  renderOverlayHtml,
  shouldTrackOverlayMove,
  shouldUpdateOverlaySizeFromBounds,
  shouldHandleOverlayResizeEvent,
  shouldShowOverlayForCursor
} = require('./desktopOverlay');

// Some environments (VM/remote desktop/sandbox) cannot launch Electron GPU process.
// Force software rendering to avoid startup crash.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

const PARTITION = 'persist:tabletop-transfer-station';
const ICON_PATH = path.join(__dirname, 'tray.ico');
const ICON_TEMPLATE_PATH = path.join(__dirname, 'trayTemplate.png');
const APP_RELAY_CONFIG_PATH = path.join(__dirname, 'relay.config.json');
const APP_DISPLAY_NAME = 'Tabletop transfer station';
app.setName(APP_DISPLAY_NAME);

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let tray = null;
let loginWin = null;
let setupWin = null;
let overlayWin = null;
let refreshTimer = null;
let overlayHoverTimer = null;
let overlayMoveTimer = null;
let lastBalanceText = '未登录';
let lastDetailText = '-';
let lastPlanText = '-';
let lastKeysText = 'API Keys: -';
let lastAccountText = '账号: -';
let lastInviteCodeText = '邀请码: -';
let lastInviteLink = '';
let isFetching = false;
let loginDetectTimer = null;
let refreshSeconds = 60;
let pendingLoginCredentials = null;
let setupIpcHandlersRegistered = false;
let overlayEnabled = true;
let overlayVisible = false;
let overlayEdge = 'right';
let overlayDragging = false;
let overlayProgrammaticMove = false;
let overlaySavedBounds = null;
let overlayResizeStart = null;
let overlayAnimationTimer = null;
let overlayProgrammaticMoveReleaseTimer = null;
let overlayEnforcingSize = false;
const REFRESH_OPTIONS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
let overlaySize = getOverlaySize();
let relayConfig = null;
const OVERLAY_MARGIN = 24;
const OVERLAY_PEEK_SIZE = 12;
const OVERLAY_REVEAL_DISTANCE = 42;
const OVERLAY_REVEAL_HANDLE_SIZE = 96;
const OVERLAY_MIN_WIDTH = 260;
const OVERLAY_MIN_HEIGHT = 360;
const OVERLAY_ANIMATION_FRAMES = 12;
const OVERLAY_ANIMATION_INTERVAL_MS = 16;
const OVERLAY_HOVER_INTERVAL_MS = 48;
const OVERLAY_PROGRAMMATIC_SETTLE_MS = 120;

function createEmptyIcon() {
  // 透明 16x16，避免依赖外部图标文件
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAE0lEQVR42mP8z8AARMAgGg0AAHkUAf6W2CYAAAAASUVORK5CYII=';
  return nativeImage.createFromDataURL(`data:image/png;base64,${pngBase64}`);
}

function createTrayIcon() {
  let icon;
  if (process.platform === 'darwin') {
    icon = nativeImage.createFromPath(ICON_TEMPLATE_PATH);
    if (!icon.isEmpty()) {
      icon.setTemplateImage(true);
      // 18x18 is typical menubar icon size on macOS.
      icon = icon.resize({ width: 18, height: 18, quality: 'best' });
    }
  } else {
    icon = nativeImage.createFromPath(ICON_PATH);
    if (!icon.isEmpty()) {
      // Force small tray-friendly size to avoid Windows scaling issues.
      icon = icon.resize({ width: 16, height: 16, quality: 'best' });
    }
  }
  if (!icon.isEmpty()) return icon;
  return createEmptyIcon();
}

function restartRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(fetchWalletBalance, refreshSeconds * 1000);
}

function getOverlayConfigPath() {
  return path.join(app.getPath('userData'), 'overlay-config.json');
}

function getUserRelayConfigPath() {
  return path.join(app.getPath('userData'), 'relay.config.json');
}

function reloadRelayConfig() {
  relayConfig = null;
  loadRelayConfig();
  return relayConfig;
}

function loadRelayConfig() {
  try {
    relayConfig = buildRelayConfig(null, {
      appConfigPath: APP_RELAY_CONFIG_PATH,
      userConfigPath: getUserRelayConfigPath()
    });
  } catch (err) {
    relayConfig = buildRelayConfig();
    console.error('[relay-config]', err);
  }
}

function getRelayConfig() {
  if (!relayConfig) loadRelayConfig();
  return relayConfig;
}

function ensureUserRelayConfigFile() {
  const userConfigPath = getUserRelayConfigPath();
  if (!fs.existsSync(userConfigPath)) {
    fs.copyFileSync(APP_RELAY_CONFIG_PATH, userConfigPath);
  }
  return userConfigPath;
}

function saveUserRelayBaseUrl(baseUrl) {
  const userConfigPath = ensureUserRelayConfigFile();
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
  } catch {
    data = {};
  }
  const effectiveConfig = buildRelayConfig({ baseUrl });
  data.baseUrl = effectiveConfig.baseUrl;
  if (effectiveConfig.preset) {
    data.paths = effectiveConfig.paths;
    data.preset = effectiveConfig.preset;
  } else {
    delete data.paths;
    delete data.preset;
  }
  fs.writeFileSync(userConfigPath, JSON.stringify(data, null, 2));
  reloadRelayConfig();
  return userConfigPath;
}

function relayNeedsSetup() {
  return isPlaceholderRelayConfig(getRelayConfig());
}

function setRelaySetupState() {
  const configPath = ensureUserRelayConfigFile();
  lastBalanceText = '未配置中转站';
  lastDetailText = `请修改配置文件: ${configPath}`;
  lastPlanText = '配置后退出并重新启动应用';
  lastKeysText = 'API Keys: -';
  lastAccountText = '账号: -';
  lastInviteCodeText = '邀请码: -';
  lastInviteLink = '';
  updateTrayMenu();
  return configPath;
}

function openRelayConfigFile() {
  return shell.openPath(ensureUserRelayConfigFile());
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeSetupBaseUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('中转站 URL 必须以 http:// 或 https:// 开头');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function renderSetupHtml({ baseUrl = '', error = '' } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      margin: 0;
      min-height: 100%;
      font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif;
      background: #f6f8fb;
      color: #172033;
    }
    body {
      display: grid;
      place-items: center;
    }
    .panel {
      width: min(520px, calc(100vw - 48px));
      padding: 26px;
      border-radius: 10px;
      background: #ffffff;
      border: 1px solid #dde5f0;
      box-shadow: 0 18px 45px rgba(23, 32, 51, 0.12);
      box-sizing: border-box;
    }
    h1 {
      margin: 0 0 18px;
      font-size: 22px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    label {
      display: block;
      margin: 14px 0 7px;
      font-size: 13px;
      color: #46566d;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      height: 38px;
      border: 1px solid #c8d3e2;
      border-radius: 7px;
      padding: 0 11px;
      font-size: 14px;
      outline: none;
    }
    input:focus {
      border-color: #2386d9;
      box-shadow: 0 0 0 3px rgba(35, 134, 217, 0.14);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 22px;
    }
    button {
      height: 38px;
      border: 0;
      border-radius: 7px;
      padding: 0 16px;
      font-size: 14px;
      cursor: pointer;
    }
    .primary {
      color: #fff;
      background: #1677c8;
    }
    .secondary {
      color: #26364d;
      background: #e9eef5;
    }
    .error {
      min-height: 20px;
      margin-top: 12px;
      color: #b42318;
      font-size: 13px;
      line-height: 1.45;
    }
    .note {
      margin-top: 10px;
      color: #69778a;
      font-size: 12px;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <form class="panel" id="setupForm">
    <h1>登录 ${APP_DISPLAY_NAME}</h1>
    <label for="baseUrl">中转站 URL</label>
    <input id="baseUrl" name="baseUrl" type="url" required placeholder="https://your-relay.example.com" value="${escapeHtml(baseUrl)}" />
    <label for="account">账号</label>
    <input id="account" name="account" autocomplete="username" placeholder="手机号或邮箱" />
    <label for="password">密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password" placeholder="登录密码" />
    <div class="note">URL 会保存到本地配置文件。账号和密码只用于本次打开登录页时自动填表，不会写入配置文件。</div>
    <div class="error" id="error">${escapeHtml(error)}</div>
    <div class="actions">
      <button class="secondary" id="openConfig" type="button">打开配置文件</button>
      <button class="primary" type="submit">保存并登录</button>
    </div>
  </form>
  <script>
    const { ipcRenderer } = require('electron');
    const form = document.getElementById('setupForm');
    const error = document.getElementById('error');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const result = await ipcRenderer.invoke('setup-login-submit', {
        baseUrl: form.baseUrl.value,
        account: form.account.value,
        password: form.password.value
      });
      if (!result.ok) error.textContent = result.error || '保存失败';
    });
    document.getElementById('openConfig').addEventListener('click', () => {
      ipcRenderer.invoke('setup-open-config');
    });
  </script>
</body>
</html>`;
}

function registerSetupIpcHandlers() {
  if (setupIpcHandlersRegistered) return;
  setupIpcHandlersRegistered = true;

  ipcMain.handle('setup-open-config', async () => {
    await openRelayConfigFile();
    return { ok: true };
  });

  ipcMain.handle('setup-login-submit', async (_event, payload) => {
    try {
      const baseUrl = normalizeSetupBaseUrl(payload?.baseUrl);
      saveUserRelayBaseUrl(baseUrl);
      pendingLoginCredentials = {
        account: String(payload?.account || ''),
        password: String(payload?.password || '')
      };
      if (setupWin && !setupWin.isDestroyed()) setupWin.close();
      lastBalanceText = '未登录';
      lastDetailText = '请在登录页完成登录';
      lastPlanText = '-';
      updateTrayMenu();
      openLoginWindow();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

function openSetupWindow() {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.focus();
    return;
  }

  registerSetupIpcHandlers();
  const config = getRelayConfig();
  setupWin = new BrowserWindow({
    width: 620,
    height: 520,
    title: `登录 ${APP_DISPLAY_NAME}`,
    autoHideMenuBar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  setupWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderSetupHtml({
    baseUrl: isPlaceholderRelayConfig(config) ? '' : config.baseUrl
  }))}`);
  setupWin.on('closed', () => {
    setupWin = null;
  });
}

function loadOverlayConfig() {
  try {
    const raw = fs.readFileSync(getOverlayConfigPath(), 'utf8');
    const data = JSON.parse(raw);
    if (['left', 'right', 'top', 'bottom'].includes(data.edge)) overlayEdge = data.edge;
    if (data.size && Number.isFinite(data.size.width) && Number.isFinite(data.size.height)) {
      overlaySize = {
        width: Math.max(OVERLAY_MIN_WIDTH, Math.min(900, data.size.width)),
        height: Math.max(OVERLAY_MIN_HEIGHT, Math.min(760, data.size.height))
      };
    }
    if (data.bounds && Number.isFinite(data.bounds.x) && Number.isFinite(data.bounds.y)) {
      overlaySavedBounds = {
        x: data.bounds.x,
        y: data.bounds.y,
        width: overlaySize.width,
        height: overlaySize.height
      };
    }
  } catch {
    // First run or invalid config: use defaults.
  }
}

function saveOverlayConfig() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const bounds = overlaySavedBounds || overlayWin.getBounds();
  fs.writeFileSync(getOverlayConfigPath(), JSON.stringify({
    edge: overlayEdge,
    bounds: {
      x: bounds.x,
      y: bounds.y
    },
    size: {
      width: overlaySize.width,
      height: overlaySize.height
    }
  }, null, 2));
}

function getOverlayState() {
  return {
    balanceText: lastBalanceText,
    detailText: lastDetailText,
    planText: lastPlanText,
    accountText: lastAccountText,
    inviteCodeText: lastInviteCodeText,
    keysText: lastKeysText
  };
}

function getOverlayDisplayBounds() {
  const point = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(point).bounds;
}

function getOverlayVisibleBounds() {
  const point = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(point).workArea;
}

function getOverlayWindowBoundsForPosition() {
  if (overlaySavedBounds) {
    return {
      ...overlaySavedBounds,
      width: overlaySize.width,
      height: overlaySize.height
    };
  }
  const displayBounds = screen.getPrimaryDisplay().bounds;
  return getDefaultOverlayPlacement({
    displayBounds,
    windowBounds: overlaySize,
    margin: OVERLAY_MARGIN
  }).bounds;
}

function getOverlayTargetPosition(visible) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const displayBounds = getOverlayDisplayBounds();
  return getOverlayPosition({
    displayBounds,
    visibleBounds: getOverlayVisibleBounds(),
    windowBounds: getOverlayWindowBoundsForPosition(),
    edge: overlayEdge,
    visible,
    margin: OVERLAY_MARGIN,
    peekSize: OVERLAY_PEEK_SIZE
  });
}

function stopOverlayAnimation() {
  if (overlayAnimationTimer) {
    clearInterval(overlayAnimationTimer);
    overlayAnimationTimer = null;
  }
}

function releaseOverlayProgrammaticMoveSoon() {
  if (overlayProgrammaticMoveReleaseTimer) {
    clearTimeout(overlayProgrammaticMoveReleaseTimer);
  }
  overlayProgrammaticMoveReleaseTimer = setTimeout(() => {
    overlayProgrammaticMove = false;
    overlayProgrammaticMoveReleaseTimer = null;
  }, OVERLAY_PROGRAMMATIC_SETTLE_MS);
}

function sendOverlayState() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (overlayWin.webContents.isLoading()) {
    overlayWin.webContents.once('did-finish-load', sendOverlayState);
    return;
  }
  overlayWin.webContents.send('overlay-state', {
    visible: overlayVisible,
    edge: overlayEdge
  });
}

function moveOverlayWindow({ animated = true, onComplete = null } = {}) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const position = getOverlayTargetPosition(overlayVisible);
  if (!position) return;

  stopOverlayAnimation();
  overlayProgrammaticMove = true;
  overlaySavedBounds = {
    ...position,
    ...overlaySize
  };

  if (overlayVisible) updateOverlayShape(true);

  const setConfiguredBounds = (nextPosition) => {
    overlayWin.setBounds(getOverlayMoveBounds({
      position: nextPosition,
      windowBounds: overlaySize
    }), false);
  };

  const finishMove = () => {
    setConfiguredBounds(position);
    updateOverlayShape();
    releaseOverlayProgrammaticMoveSoon();
    if (onComplete) onComplete();
  };

  if (!animated) {
    finishMove();
    return;
  }

  const current = overlayWin.getBounds();
  const frames = getOverlayAnimationFrames({
    from: { x: current.x, y: current.y },
    to: position,
    frameCount: OVERLAY_ANIMATION_FRAMES
  });
  let frameIndex = 0;
  overlayAnimationTimer = setInterval(() => {
    if (!overlayWin || overlayWin.isDestroyed()) {
      stopOverlayAnimation();
      return;
    }
    const frame = frames[frameIndex];
    setConfiguredBounds(frame);
    frameIndex += 1;
    if (frameIndex >= frames.length) {
      stopOverlayAnimation();
      finishMove();
    }
  }, OVERLAY_ANIMATION_INTERVAL_MS);
}

function updateOverlayContent() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const rows = buildOverlayRows(getOverlayState());
  overlayWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderOverlayHtml(rows, {
    visible: overlayVisible,
    edge: overlayEdge
  }))}`);
}

function updateOverlayShape(forceVisible = false) {
  if (!overlayWin || overlayWin.isDestroyed() || typeof overlayWin.setShape !== 'function') return;
  const current = overlayWin.getBounds();
  const bounds = {
    x: current.x,
    y: current.y,
    width: overlaySize.width,
    height: overlaySize.height
  };
  overlayWin.setShape(getOverlayShapeRects({
    windowBounds: bounds,
    edge: overlayEdge,
    visible: forceVisible || overlayVisible,
    peekSize: OVERLAY_PEEK_SIZE,
    handleSize: OVERLAY_REVEAL_HANDLE_SIZE
  }));
}

function enforceOverlayConfiguredSize() {
  if (!overlayWin || overlayWin.isDestroyed() || overlayResizeStart || overlayEnforcingSize) return;
  const bounds = overlayWin.getBounds();
  if (bounds.width === overlaySize.width && bounds.height === overlaySize.height) return;
  overlayEnforcingSize = true;
  overlayWin.setBounds({
    x: bounds.x,
    y: bounds.y,
    width: overlaySize.width,
    height: overlaySize.height
  }, false);
  overlayEnforcingSize = false;
  updateOverlayShape();
}

function setOverlayVisibility(visible) {
  if (!overlayEnabled || !overlayWin || overlayWin.isDestroyed()) return;
  if (overlayVisible === visible) return;
  overlayVisible = visible;
  if (overlayVisible) sendOverlayState();
  moveOverlayWindow({
    onComplete: () => {
      if (!overlayVisible) sendOverlayState();
    }
  });
}

function shouldTrackCurrentOverlayMove() {
  return shouldTrackOverlayMove({
    overlayVisible,
    overlayProgrammaticMove,
    overlayResizeActive: Boolean(overlayResizeStart)
  });
}

function startOverlayHoverWatcher() {
  if (overlayHoverTimer) clearInterval(overlayHoverTimer);
  overlayHoverTimer = setInterval(() => {
    if (!overlayEnabled || overlayDragging || !overlayWin || overlayWin.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const displayBounds = getOverlayDisplayBounds();
    const overlayBounds = overlayWin.getBounds();
    const revealBounds = overlaySavedBounds || overlayBounds;
    setOverlayVisibility(shouldShowOverlayForCursor({
      cursor,
      displayBounds,
      overlayBounds,
      revealBounds,
      edge: overlayEdge,
      overlayVisible,
      revealDistance: OVERLAY_REVEAL_DISTANCE,
      handleSize: OVERLAY_REVEAL_HANDLE_SIZE
    }));
  }, OVERLAY_HOVER_INTERVAL_MS);
}

function snapOverlayToNearestEdge() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const displayBounds = getOverlayDisplayBounds();
  const bounds = overlayWin.getBounds();
  overlayEdge = getNearestOverlayEdge({ displayBounds, windowBounds: bounds });
  overlayVisible = true;
  overlaySavedBounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };
  moveOverlayWindow();
  saveOverlayConfig();
}

function createOverlayWindow() {
  if (overlayWin && !overlayWin.isDestroyed()) return;

  overlayWin = new BrowserWindow({
    ...overlaySize,
    frame: false,
    transparent: true,
    resizable: false,
    minWidth: OVERLAY_MIN_WIDTH,
    minHeight: OVERLAY_MIN_HEIGHT,
    movable: true,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(false);
  overlayWin.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape') setOverlayVisibility(false);
  });
  overlayWin.webContents.on('ipc-message', (_event, channel) => {
    if (channel === 'overlay-drag-start') {
      if (overlayResizeStart) return;
      overlayDragging = true;
      overlayVisible = true;
    }
    if (channel === 'overlay-drag-end') {
      overlayDragging = false;
      snapOverlayToNearestEdge();
    }
  });
  overlayWin.webContents.on('ipc-message', (_event, channel, payload) => {
    if (channel === 'overlay-resize-start') {
      overlayDragging = true;
      overlayVisible = true;
      overlayResizeStart = {
        pointer: payload,
        bounds: overlayWin.getBounds()
      };
    }
    if (channel === 'overlay-resize-move' && overlayResizeStart) {
      const width = Math.max(OVERLAY_MIN_WIDTH, overlayResizeStart.bounds.width + payload.x - overlayResizeStart.pointer.x);
      const height = Math.max(OVERLAY_MIN_HEIGHT, overlayResizeStart.bounds.height + payload.y - overlayResizeStart.pointer.y);
      overlaySize = { width, height };
      overlayWin.setBounds({
        x: overlayResizeStart.bounds.x,
        y: overlayResizeStart.bounds.y,
        width,
        height
      }, false);
      updateOverlayShape();
    }
    if (channel === 'overlay-resize-end' && overlayResizeStart) {
      overlayResizeStart = null;
      overlayDragging = false;
      snapOverlayToNearestEdge();
    }
  });
  overlayWin.on('will-move', () => {
    if (!shouldTrackCurrentOverlayMove()) return;
    overlayDragging = true;
    overlayVisible = true;
  });
  overlayWin.on('move', () => {
    if (!shouldTrackCurrentOverlayMove()) return;
    overlayDragging = true;
    if (overlayMoveTimer) clearTimeout(overlayMoveTimer);
    overlayMoveTimer = setTimeout(() => {
      overlayDragging = false;
      snapOverlayToNearestEdge();
    }, 420);
  });
  overlayWin.on('resize', () => {
    enforceOverlayConfiguredSize();
  });
  overlayWin.once('ready-to-show', () => {
    if (!overlayEnabled || !overlayWin || overlayWin.isDestroyed()) return;
    overlayWin.showInactive();
    moveOverlayWindow({ animated: false });
  });
  overlayWin.on('closed', () => {
    overlayWin = null;
  });

  updateOverlayContent();
  updateOverlayShape();
  moveOverlayWindow({ animated: false });
  startOverlayHoverWatcher();
}

function setOverlayEnabled(enabled) {
  overlayEnabled = enabled;
  if (overlayEnabled) {
    createOverlayWindow();
    updateOverlayContent();
    overlayVisible = true;
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.showInactive();
    moveOverlayWindow({ animated: false });
  } else if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.hide();
  }
  updateTrayMenu();
}

function getSession() {
  return session.fromPartition(PARTITION);
}

async function hasAuthCookie() {
  const ses = getSession();
  const cookies = await ses.cookies.get({ url: getRelayConfig().baseUrl });
  return cookies.some((c) => isLikelyAuthCookieName(c.name));
}

async function hasValidSession() {
  const ses = getSession();
  try {
    const res = await ses.fetch(getRelayConfig().urls.sessionApi, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!res.ok) return false;
    const data = await readJsonResponse(res, '登录态接口');
    return hasSessionIdentity(data);
  } catch {
    return false;
  }
}

async function fetchSubscriptionWindow(commonHeaders) {
  const ses = getSession();
  for (const url of getRelayConfig().urls.dashboardRscCandidates) {
    try {
      const res = await ses.fetch(url, {
        method: 'GET',
        headers: {
          ...commonHeaders,
          'Accept': 'text/x-component, text/html, */*',
          'rsc': '1'
        }
      });
      if (!res.ok) continue;
      const text = await res.text();

      // RSC often uses "$D2026-05-17T05:20:59.947Z"
      const subStartMatch =
        text.match(/"subscriptionStartedAt":"\$D([^"]+)"/) ||
        text.match(/"subscriptionStartedAt":"([^"]+)"/);
      const subExpireMatch =
        text.match(/"subscriptionExpiresAt":"\$D([^"]+)"/) ||
        text.match(/"subscriptionExpiresAt":"([^"]+)"/);

      if (subExpireMatch) {
        const start = subStartMatch ? new Date(subStartMatch[1]) : null;
        const expire = new Date(subExpireMatch[1]);
        if (!Number.isNaN(expire.getTime())) {
          return { start, expire };
        }
      }
    } catch (_) {
      // try next candidate
    }
  }
  return { start: null, expire: null };
}

async function readJsonResponse(res, label) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const text = await res.text().catch(() => '');
    const preview = text.replace(/\s+/g, ' ').trim().slice(0, 80);
    const suffix = preview ? `，返回内容开头: ${preview}` : '';
    throw new Error(`${label} 返回的不是 JSON，可能填了网页页面地址，或该中转站接口路径不兼容${suffix}`);
  }
  return res.json();
}

async function readOptionalJsonResponse(res, label) {
  if (!res.ok) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    console.warn(`[relay-json] ${label} skipped non-json response: ${contentType}`);
    return null;
  }
  return readJsonResponse(res, label);
}

async function fetchWalletBalance() {
  if (isFetching) return;
  isFetching = true;

  try {
    const ses = getSession();
    const hasCookie = await hasAuthCookie();
    if (!hasCookie) {
      lastBalanceText = '未登录';
      lastDetailText = '无可用会话';
      updateTrayMenu();
      return;
    }

    const commonHeaders = {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    const [walletRes, usageRes, sessionRes, keysRes, profileRes, inviteRes, subWindow] = await Promise.all([
      ses.fetch(getRelayConfig().urls.walletApi, { method: 'GET', headers: commonHeaders }),
      ses.fetch(getRelayConfig().urls.usageApi, { method: 'GET', headers: commonHeaders }),
      ses.fetch(getRelayConfig().urls.sessionApi, { method: 'GET', headers: commonHeaders }),
      ses.fetch(getRelayConfig().urls.apiKeysApi, { method: 'GET', headers: commonHeaders }),
      ses.fetch(getRelayConfig().urls.profileApi, { method: 'GET', headers: commonHeaders }),
      ses.fetch(getRelayConfig().urls.inviteInfoApi, { method: 'GET', headers: commonHeaders }),
      fetchSubscriptionWindow(commonHeaders)
    ]);

    if (walletRes.status === 401 || walletRes.status === 403) {
      await clearAuth(false);
      lastBalanceText = '登录已失效';
      lastDetailText = `HTTP ${walletRes.status}`;
      updateTrayMenu();
      return;
    }

    if (!walletRes.ok) {
      lastBalanceText = '请求失败';
      lastDetailText = `HTTP ${walletRes.status}`;
      updateTrayMenu();
      return;
    }

    const walletData = await readJsonResponse(walletRes, '余额接口');
    const usageData = await readOptionalJsonResponse(usageRes, '用量接口');
    const sessionData = await readOptionalJsonResponse(sessionRes, '登录态接口');
    const keysData = await readOptionalJsonResponse(keysRes, 'API Key 接口');
    const profileData = await readOptionalJsonResponse(profileRes, '用户资料接口');
    const inviteData = await readOptionalJsonResponse(inviteRes, '邀请信息接口');
    const snapshot = buildBalanceSnapshot({
      walletData,
      usageData,
      sessionData,
      keysData,
      profileData,
      inviteData,
      subWindow,
      relayConfig: getRelayConfig()
    });

    lastBalanceText = snapshot.balanceText;
    lastDetailText = snapshot.detailText;
    lastPlanText = snapshot.planText;
    lastKeysText = snapshot.keysText;
    lastAccountText = snapshot.accountText;
    lastInviteCodeText = snapshot.inviteCodeText;
    lastInviteLink = snapshot.inviteLink;
    updateTrayMenu();
  } catch (err) {
    lastBalanceText = '网络异常';
    lastDetailText = String(err?.message || err);
    updateTrayMenu();
  } finally {
    isFetching = false;
  }
}

function openLoginWindow() {
  if (relayNeedsSetup()) {
    setRelaySetupState();
    openSetupWindow();
    return;
  }

  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return;
  }

  loginWin = new BrowserWindow({
    width: 1100,
    height: 760,
    title: `登录 ${APP_DISPLAY_NAME}`,
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  loginWin.loadURL(getRelayConfig().urls.login);
  loginWin.webContents.on('did-finish-load', async () => {
    if (!pendingLoginCredentials) return;
    const { account, password } = pendingLoginCredentials;
    await loginWin.webContents.executeJavaScript(`
      (() => {
        const setValue = (element, value) => {
          if (!element || !value) return false;
          element.focus();
          element.value = value;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };
        const accountInput = document.querySelector('input[type="email"], input[type="tel"], input[name*="email" i], input[name*="phone" i], input[name*="user" i], input[autocomplete="username"], input:not([type]), input[type="text"]');
        const passwordInput = document.querySelector('input[type="password"], input[autocomplete="current-password"]');
        setValue(accountInput, ${JSON.stringify(account)});
        setValue(passwordInput, ${JSON.stringify(password)});
      })();
    `).catch(() => {});
  });

  loginWin.webContents.on('did-fail-load', (_event, code, desc, url) => {
    // Cloudflare / SPA jumps often trigger ERR_ABORTED(-3) on about:srcdoc.
    // This is usually an intermediate navigation, not a real failure.
    if (code === -3 || url === 'about:srcdoc') {
      return;
    }
    lastBalanceText = '登录页加载失败';
    lastDetailText = `${code} ${desc}`;
    updateTrayMenu();
    loginWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
      `<h3>页面加载失败</h3><p>URL: ${url}</p><p>错误: ${code} ${desc}</p><p>请检查网络或证书环境</p>`
    )}`);
  });

  loginWin.webContents.on('console-message', (_e, level, message) => {
    if (level <= 2) {
      console.log('[login-web]', message);
    }
  });

  const tryHandleLoginSuccess = async () => {
    const ok = await hasValidSession();
    if (!ok) return;
    pendingLoginCredentials = null;
    lastBalanceText = '登录成功';
    lastDetailText = '正在拉取余额...';
    updateTrayMenu();
    await fetchWalletBalance();
    if (Notification.isSupported()) {
      new Notification({
        title: APP_DISPLAY_NAME,
        body: '登录成功，已刷新余额'
      }).show();
    }
    if (loginWin && !loginWin.isDestroyed()) {
      loginWin.close();
    }
  };

  loginWin.webContents.on('did-navigate', async () => {
    await tryHandleLoginSuccess();
  });
  loginWin.webContents.on('did-stop-loading', async () => {
    await tryHandleLoginSuccess();
  });

  loginWin.on('closed', () => {
    loginWin = null;
    if (loginDetectTimer) {
      clearInterval(loginDetectTimer);
      loginDetectTimer = null;
    }
  });

  // 兜底轮询，避免某些页面跳转事件不触发
  loginDetectTimer = setInterval(async () => {
    if (!loginWin || loginWin.isDestroyed()) return;
    await tryHandleLoginSuccess();
  }, 2000);
}

function clearAuth(updateMenu = true) {
  const ses = getSession();
  return ses.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers']
  }).then(() => {
    lastBalanceText = '已退出';
    lastDetailText = '-';
    lastPlanText = '-';
    lastKeysText = 'API Keys: -';
    lastAccountText = '账号: -';
    lastInviteCodeText = '邀请码: -';
    lastInviteLink = '';
    if (updateMenu) updateTrayMenu();
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const needsSetup = relayNeedsSetup();
  tray.setToolTip(`${APP_DISPLAY_NAME} ${lastBalanceText} - ${getRelayConfig().baseUrl}`);
  updateOverlayContent();

  const menu = Menu.buildFromTemplate([
    { label: `中转站: ${getRelayConfig().baseUrl}`, click: () => {} },
    { label: `状态: ${lastBalanceText}`, click: () => {} },
    { label: `详情: ${lastDetailText}`, click: () => {} },
    { label: `${lastPlanText}`, click: () => {} },
    { label: `${lastAccountText}`, click: () => {} },
    { label: `${lastInviteCodeText}`, click: () => {} },
    { label: `${lastKeysText}`, click: () => {} },
    { type: 'separator' },
    {
      label: '复制邀请链接',
      enabled: !!lastInviteLink,
      click: () => {
        if (!lastInviteLink) return;
        clipboard.writeText(lastInviteLink);
        if (Notification.isSupported()) {
          new Notification({
            title: APP_DISPLAY_NAME,
            body: '邀请链接已复制'
          }).show();
        }
      }
    },
    {
      label: '打开钱包页',
      enabled: !needsSetup,
      click: () => shell.openExternal(getRelayConfig().urls.dashboardWallet)
    },
    {
      label: '打开中转站配置文件',
      click: () => openRelayConfigFile()
    },
    {
      label: '打开登录设置',
      click: () => openSetupWindow()
    },
    {
      label: '打开配置目录',
      click: () => shell.openPath(app.getPath('userData'))
    },
    {
      label: '立即刷新余额',
      enabled: !needsSetup,
      click: () => fetchWalletBalance()
    },
    {
      label: '桌面悬浮显示',
      type: 'checkbox',
      checked: overlayEnabled,
      click: (item) => setOverlayEnabled(item.checked)
    },
    {
      label: `设置刷新频率（当前${refreshSeconds}秒）`,
      submenu: REFRESH_OPTIONS.map((sec) => ({
        label: `${sec} 秒`,
        type: 'radio',
        checked: refreshSeconds === sec,
        click: () => {
          refreshSeconds = sec;
          restartRefreshTimer();
          updateTrayMenu();
        }
      }))
    },
    {
      label: '清除登录态',
      click: async () => {
        await clearAuth();
        openLoginWindow();
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(menu);
}

async function bootstrap() {
  loadRelayConfig();
  loadOverlayConfig();
  tray = new Tray(createTrayIcon());
  createOverlayWindow();
  updateTrayMenu();

  if (relayNeedsSetup()) {
    setRelaySetupState();
    openSetupWindow();
    return;
  }

  const loggedIn = await hasValidSession();
  if (loggedIn) {
    lastBalanceText = '已登录';
    lastDetailText = '初始化拉取...';
    updateTrayMenu();
    await fetchWalletBalance();
    openSetupWindow();
  } else {
    lastBalanceText = '未登录';
    lastDetailText = '请填写登录信息';
    updateTrayMenu();
    openSetupWindow();
  }

  restartRefreshTimer();
}

app.whenReady().then(bootstrap);

app.on('second-instance', () => {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.focus();
    return;
  }
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return;
  }
  openSetupWindow();
});

app.on('window-all-closed', () => {
  // 托盘应用不自动退出
});

app.on('before-quit', () => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (overlayHoverTimer) clearInterval(overlayHoverTimer);
  if (overlayMoveTimer) clearTimeout(overlayMoveTimer);
});

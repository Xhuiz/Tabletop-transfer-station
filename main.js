// Project: Tabletop transfer station (Electron)
const { app, BrowserWindow, Tray, Menu, session, nativeImage, shell, Notification, clipboard, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { buildRelayConfig, isPlaceholderRelayConfig } = require('./relayConfig');
const {
  buildOverlayRows,
  getDefaultOverlayPlacement,
  getOverlayAnimationFrames,
  getOverlaySize,
  getOverlayShapeRects,
  getNearestOverlayEdge,
  getOverlayPosition,
  renderOverlayHtml,
  shouldTrackOverlayMove,
  shouldUpdateOverlaySizeFromBounds,
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

let tray = null;
let loginWin = null;
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
let exitConfirmUntil = 0;
let refreshSeconds = 60;
let overlayEnabled = true;
let overlayVisible = false;
let overlayEdge = 'right';
let overlayDragging = false;
let overlayProgrammaticMove = false;
let overlaySavedBounds = null;
let overlayResizeStart = null;
let overlayAnimationTimer = null;
let overlayProgrammaticMoveReleaseTimer = null;
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

  const finishMove = () => {
    overlayWin.setPosition(position.x, position.y, false);
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
    overlayWin.setPosition(frame.x, frame.y, false);
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
  const bounds = overlayWin.getBounds();
  overlayWin.setShape(getOverlayShapeRects({
    windowBounds: bounds,
    edge: overlayEdge,
    visible: forceVisible || overlayVisible,
    peekSize: OVERLAY_PEEK_SIZE,
    handleSize: OVERLAY_REVEAL_HANDLE_SIZE
  }));
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
    resizable: true,
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
      if (shouldUpdateOverlaySizeFromBounds({ overlayResizeActive: true, overlayProgrammaticMove })) {
        overlaySize = { width, height };
      }
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
    if (!shouldTrackCurrentOverlayMove()) return;
    const bounds = overlayWin.getBounds();
    if (shouldUpdateOverlaySizeFromBounds({ overlayResizeActive: true, overlayProgrammaticMove })) {
      overlaySize = {
        width: bounds.width,
        height: bounds.height
      };
    }
    if (overlayMoveTimer) clearTimeout(overlayMoveTimer);
    overlayMoveTimer = setTimeout(() => {
      overlaySavedBounds = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      };
      updateOverlayShape();
      snapOverlayToNearestEdge();
    }, 420);
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
  return cookies.some((c) => {
    const n = (c.name || '').toLowerCase();
    return n.includes('session') || n.includes('authjs') || n.includes('token');
  });
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
    const data = await res.json();
    return !!data?.user?.id;
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

    const [walletRes, sessionRes, keysRes, profileRes, inviteRes, subWindow] = await Promise.all([
      ses.fetch(getRelayConfig().urls.walletApi, { method: 'GET', headers: commonHeaders }),
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

    const walletData = await walletRes.json();
    const sessionData = sessionRes.ok ? await sessionRes.json() : null;
    const keysData = keysRes.ok ? await keysRes.json() : null;
    const profileData = profileRes.ok ? await profileRes.json() : null;
    const inviteData = inviteRes.ok ? await inviteRes.json() : null;
    const balRaw = walletData?.data?.balance;
    const bonusRaw = walletData?.data?.bonusBalance;

    const bal = Number(balRaw);
    const bonus = Number(bonusRaw);

    const balCny = Number.isFinite(bal) ? (bal / 1000).toFixed(2) : '-';
    const bonusCny = Number.isFinite(bonus) ? (bonus / 1000).toFixed(2) : '-';
    const totalCny = (Number.isFinite(bal) ? bal : 0) + (Number.isFinite(bonus) ? bonus : 0);
    const totalCnyText = (totalCny / 1000).toFixed(2);

    const plan = sessionData?.user?.plan || '-';
    // Prefer exact subscription window from dashboard payload.
    const subStart = subWindow?.start || null;
    const subExpire = subWindow?.expire || null;
    const daysLeft = subExpire && !Number.isNaN(subExpire.getTime())
      ? Math.max(0, Math.ceil((subExpire.getTime() - Date.now()) / (24 * 3600 * 1000)))
      : null;

    const keyRows = Array.isArray(keysData?.data) ? keysData.data : [];
    const keySummary = keyRows
      .map((k) => {
        const name = k?.name || '(未命名)';
        const total = Number(k?.totalConsumed || 0);
        const cny = Number.isFinite(total) ? (total / 1000).toFixed(2) : '0.00';
        return `${name}:¥${cny}`;
      })
      .join(' | ');

    lastBalanceText = `余额: ${totalCnyText}`;
    lastDetailText = `订阅￥${balCny} / 按量￥${bonusCny}`;
    if (subStart && subExpire && !Number.isNaN(subStart.getTime()) && !Number.isNaN(subExpire.getTime())) {
      lastPlanText = `当前订阅：${plan} ｜ 剩余${daysLeft}天`;
    } else if (daysLeft !== null) {
      lastPlanText = `当前订阅：${plan} ｜ 剩余${daysLeft}天`;
    } else {
      lastPlanText = `当前订阅：${plan}`;
    }
    lastKeysText = keySummary ? `API Keys: ${keySummary}` : 'API Keys: -';
    const account = sessionData?.user?.phone || profileData?.user?.phone || profileData?.user?.email || '-';
    lastAccountText = `账号: ${account}`;

    const inviteCode =
      inviteData?.data?.inviteCode ||
      inviteData?.inviteCode ||
      '';
    const inviteLink =
      inviteData?.data?.inviteLink ||
      inviteData?.data?.inviteUrl ||
      inviteData?.inviteLink ||
      inviteData?.inviteUrl ||
      (inviteCode ? getRelayConfig().urls.inviteRegister(inviteCode) : '');
    lastInviteCodeText = inviteCode ? `邀请码: ${inviteCode}` : '邀请码: -';
    lastInviteLink = inviteLink || '';
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
    openRelayConfigFile();
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
      label: Date.now() < exitConfirmUntil ? '确认退出（再次点击）' : '退出（需二次确认）',
      click: () => {
        const now = Date.now();
        if (now < exitConfirmUntil) {
          app.quit();
          return;
        }
        exitConfirmUntil = now + 10_000;
        if (Notification.isSupported()) {
          new Notification({
            title: APP_DISPLAY_NAME,
            body: '请在10秒内再次点击“退出”以确认'
          }).show();
        }
        updateTrayMenu();
      }
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
    return;
  }

  const loggedIn = await hasValidSession();
  if (loggedIn) {
    lastBalanceText = '已登录';
    lastDetailText = '初始化拉取...';
    updateTrayMenu();
    await fetchWalletBalance();
  } else {
    lastBalanceText = '未登录';
    lastDetailText = '请先登录';
    updateTrayMenu();
    openLoginWindow();
  }

  restartRefreshTimer();
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  // 托盘应用不自动退出
});

app.on('before-quit', () => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (overlayHoverTimer) clearInterval(overlayHoverTimer);
  if (overlayMoveTimer) clearTimeout(overlayMoveTimer);
});

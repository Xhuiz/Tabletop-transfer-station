function buildOverlayRows(state) {
  return [
    `状态: ${state.balanceText}`,
    `详情: ${state.detailText}`,
    state.planText,
    state.accountText,
    state.inviteCodeText,
    state.keysText
  ];
}

function getOverlaySize() {
  return { width: 280, height: 500 };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getNearestOverlayEdge({ displayBounds, windowBounds }) {
  const distances = {
    left: Math.abs(windowBounds.x - displayBounds.x),
    right: Math.abs(displayBounds.x + displayBounds.width - (windowBounds.x + windowBounds.width)),
    top: Math.abs(windowBounds.y - displayBounds.y),
    bottom: Math.abs(displayBounds.y + displayBounds.height - (windowBounds.y + windowBounds.height))
  };

  return Object.entries(distances)
    .sort((a, b) => a[1] - b[1])[0][0];
}

function getDefaultOverlayPlacement({ displayBounds, windowBounds, margin = 24 }) {
  return {
    edge: 'right',
    bounds: {
      x: displayBounds.x + displayBounds.width - windowBounds.width - margin,
      y: displayBounds.y + margin,
      width: windowBounds.width,
      height: windowBounds.height
    }
  };
}

function isBetween(value, min, max) {
  return value >= min && value <= max;
}

function getCenteredRange(start, size, handleSize) {
  const normalizedHandleSize = Math.min(size, Math.max(1, handleSize));
  const rangeStart = start + (size - normalizedHandleSize) / 2;
  return {
    start: rangeStart,
    end: rangeStart + normalizedHandleSize
  };
}

function isCursorInOverlayRevealZone({
  cursor,
  displayBounds,
  windowBounds,
  edge,
  revealDistance = 42,
  handleSize = 96
}) {
  if (edge === 'left') {
    const handleRange = getCenteredRange(windowBounds.y, windowBounds.height, handleSize);
    return cursor.x <= displayBounds.x + revealDistance &&
      isBetween(cursor.y, handleRange.start, handleRange.end);
  }
  if (edge === 'right') {
    const handleRange = getCenteredRange(windowBounds.y, windowBounds.height, handleSize);
    return cursor.x >= displayBounds.x + displayBounds.width - revealDistance &&
      isBetween(cursor.y, handleRange.start, handleRange.end);
  }
  if (edge === 'top') {
    const handleRange = getCenteredRange(windowBounds.x, windowBounds.width, handleSize);
    return cursor.y <= displayBounds.y + revealDistance &&
      isBetween(cursor.x, handleRange.start, handleRange.end);
  }
  if (edge === 'bottom') {
    const handleRange = getCenteredRange(windowBounds.x, windowBounds.width, handleSize);
    return cursor.y >= displayBounds.y + displayBounds.height - revealDistance &&
      isBetween(cursor.x, handleRange.start, handleRange.end);
  }
  return false;
}

function isCursorInsideBounds(cursor, bounds) {
  return cursor.x >= bounds.x &&
    cursor.x <= bounds.x + bounds.width &&
    cursor.y >= bounds.y &&
    cursor.y <= bounds.y + bounds.height;
}

function shouldShowOverlayForCursor({
  cursor,
  displayBounds,
  overlayBounds,
  revealBounds = overlayBounds,
  edge,
  overlayVisible,
  revealDistance = 42,
  handleSize = 96
}) {
  if (isCursorInOverlayRevealZone({
    cursor,
    displayBounds,
    windowBounds: revealBounds,
    edge,
    revealDistance,
    handleSize
  })) {
    return true;
  }

  return overlayVisible && isCursorInsideBounds(cursor, overlayBounds);
}

function getOverlayShapeRects({
  windowBounds,
  edge,
  visible,
  peekSize = 12,
  handleSize = 96
}) {
  const width = Math.max(1, Math.round(windowBounds.width));
  const height = Math.max(1, Math.round(windowBounds.height));

  if (visible) {
    return [{ x: 0, y: 0, width, height }];
  }

  const peekWidth = Math.min(width, Math.max(1, Math.round(peekSize)));
  const peekHeight = Math.min(height, Math.max(1, Math.round(peekSize)));
  const verticalHandle = getCenteredRange(0, height, handleSize);
  const horizontalHandle = getCenteredRange(0, width, handleSize);
  const handleY = Math.round(verticalHandle.start);
  const handleHeight = Math.round(verticalHandle.end - verticalHandle.start);
  const handleX = Math.round(horizontalHandle.start);
  const handleWidth = Math.round(horizontalHandle.end - horizontalHandle.start);

  if (edge === 'left') {
    return [{ x: width - peekWidth, y: handleY, width: peekWidth, height: handleHeight }];
  }
  if (edge === 'right') {
    return [{ x: 0, y: handleY, width: peekWidth, height: handleHeight }];
  }
  if (edge === 'top') {
    return [{ x: handleX, y: height - peekHeight, width: handleWidth, height: peekHeight }];
  }
  if (edge === 'bottom') {
    return [{ x: handleX, y: 0, width: handleWidth, height: peekHeight }];
  }

  return [{ x: 0, y: 0, width, height }];
}

function getOverlayPosition(options) {
  const {
    displayBounds,
    visibleBounds = displayBounds,
    windowBounds,
    edge = 'left',
    visible,
    margin = 24,
    peekSize = 8
  } = options;

  const visibleMinX = visibleBounds.x + margin;
  const visibleMaxX = visibleBounds.x + visibleBounds.width - windowBounds.width - margin;
  const visibleMinY = visibleBounds.y + margin;
  const visibleMaxY = visibleBounds.y + visibleBounds.height - windowBounds.height - margin;
  const safeX = clamp(windowBounds.x ?? visibleMinX, visibleMinX, Math.max(visibleMinX, visibleMaxX));
  const safeY = clamp(windowBounds.y ?? visibleMinY, visibleMinY, Math.max(visibleMinY, visibleMaxY));

  if (edge === 'right') {
    return {
      x: visible
        ? visibleBounds.x + visibleBounds.width - windowBounds.width - margin
        : displayBounds.x + displayBounds.width - peekSize,
      y: safeY
    };
  }

  if (edge === 'top') {
    return {
      x: safeX,
      y: visible
        ? visibleBounds.y + margin
        : displayBounds.y - windowBounds.height + peekSize
    };
  }

  if (edge === 'bottom') {
    return {
      x: safeX,
      y: visible
        ? visibleBounds.y + visibleBounds.height - windowBounds.height - margin
        : displayBounds.y + displayBounds.height - peekSize
    };
  }

  return {
    x: visible
      ? visibleBounds.x + margin
      : displayBounds.x - windowBounds.width + peekSize,
    y: safeY
  };
}

function easeOutCubic(progress) {
  return 1 - Math.pow(1 - progress, 3);
}

function getOverlayAnimationFrames({ from, to, frameCount = 12 }) {
  const totalFrames = Math.max(1, Math.round(frameCount));
  const frames = [];

  for (let index = 1; index <= totalFrames; index += 1) {
    const progress = easeOutCubic(index / totalFrames);
    frames.push({
      x: Math.round(from.x + (to.x - from.x) * progress),
      y: Math.round(from.y + (to.y - from.y) * progress)
    });
  }

  return frames;
}

function getOverlayMoveBounds({ position, windowBounds }) {
  return {
    x: position.x,
    y: position.y,
    width: windowBounds.width,
    height: windowBounds.height
  };
}

function shouldTrackOverlayMove({
  overlayVisible,
  overlayProgrammaticMove,
  overlayResizeActive
}) {
  return overlayVisible && !overlayProgrammaticMove && !overlayResizeActive;
}

function shouldUpdateOverlaySizeFromBounds({
  overlayResizeActive,
  overlayProgrammaticMove
}) {
  return Boolean(overlayResizeActive) && !overlayProgrammaticMove;
}

function shouldHandleOverlayResizeEvent({
  overlayResizeActive,
  overlayProgrammaticMove,
  overlayEnforcingSize = false
}) {
  return Boolean(overlayResizeActive) && !overlayProgrammaticMove && !overlayEnforcingSize;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOverlayHtml(rows, options = {}) {
  const { visible = true, edge = 'right' } = options;
  const [status, detail, plan, account, invite, keys] = rows.map(escapeHtml);
  const balanceValue = escapeHtml((rows[0].match(/余额:\s*(.+)$/) || [])[1] || rows[0].replace(/^状态:\s*/, ''));
  const visibleAttr = visible ? 'true' : 'false';
  const edgeAttr = escapeHtml(edge);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    html,
    body {
      margin: 0;
      width: 100%;
      min-height: 100%;
      overflow: hidden;
      background: transparent;
      font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif;
      user-select: none;
    }

    body {
      padding: 0;
      box-sizing: border-box;
    }

    .panel {
      box-sizing: border-box;
      width: 100vw;
      height: 100vh;
      padding: 0;
      color: #102033;
    }

    .card {
      box-sizing: border-box;
      width: 100vw;
      height: 100vh;
      padding: 14px 14px;
      border-radius: 22px;
      background:
        radial-gradient(circle at 18% 0%, rgba(72, 173, 255, 0.20), transparent 34%),
        linear-gradient(145deg, rgba(248, 252, 255, 0.96), rgba(224, 241, 255, 0.88));
      border: 1px solid rgba(120, 161, 208, 0.42);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.42);
      backdrop-filter: blur(14px);
      -webkit-app-region: drag;
      cursor: grab;
    }

    .card:active {
      cursor: grabbing;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .pulse {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #21c17a;
      box-shadow: 0 0 0 7px rgba(33, 193, 122, 0.16);
      flex: 0 0 auto;
    }

    .title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .hint {
      font-size: 11px;
      color: rgba(44, 67, 94, 0.62);
      white-space: nowrap;
    }

    .balance {
      padding: 12px 12px 10px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.68);
      border: 1px solid rgba(118, 158, 205, 0.22);
      margin-bottom: 10px;
    }

    .label {
      font-size: 12px;
      color: rgba(49, 70, 98, 0.66);
      margin-bottom: 6px;
    }

    .amount {
      font-size: 30px;
      line-height: 1.05;
      font-weight: 800;
      color: #0f2d52;
      letter-spacing: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
      margin-bottom: 9px;
    }

    .tile {
      min-width: 0;
      padding: 9px 10px;
      border-radius: 13px;
      background: rgba(255, 255, 255, 0.58);
      border: 1px solid rgba(118, 158, 205, 0.18);
    }

    .row {
      font-size: 12px;
      line-height: 1.32;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #172a43;
    }

    .wide {
      grid-column: 1 / -1;
    }

    .keys {
      padding: 9px 10px;
      border-radius: 13px;
      background: rgba(15, 45, 82, 0.08);
      border: 1px solid rgba(118, 158, 205, 0.16);
    }

    .handle {
      position: absolute;
      left: 8px;
      top: 50%;
      width: 4px;
      height: 44px;
      transform: translateY(-50%);
      border-radius: 999px;
      background: rgba(31, 101, 174, 0.38);
    }

    .resize-grip {
      position: absolute;
      right: 12px;
      bottom: 12px;
      width: 22px;
      height: 22px;
      border-radius: 7px;
      cursor: nwse-resize;
      -webkit-app-region: no-drag;
      background:
        linear-gradient(135deg, transparent 45%, rgba(31, 101, 174, 0.38) 46%, rgba(31, 101, 174, 0.38) 52%, transparent 53%),
        linear-gradient(135deg, transparent 62%, rgba(31, 101, 174, 0.28) 63%, rgba(31, 101, 174, 0.28) 69%, transparent 70%);
    }

    .overlay-state {
      display: none;
    }

    body[data-overlay-visible="false"] .card {
      padding: 0;
      background: transparent;
      border-color: transparent;
      box-shadow: none;
      backdrop-filter: none;
      cursor: default;
    }

    body[data-overlay-visible="false"] .topbar,
    body[data-overlay-visible="false"] .balance,
    body[data-overlay-visible="false"] .grid,
    body[data-overlay-visible="false"] .keys,
    body[data-overlay-visible="false"] .resize-grip {
      opacity: 0;
      pointer-events: none;
    }

    body[data-overlay-visible="false"] .handle {
      width: 12px;
      height: 96px;
      background: linear-gradient(180deg, rgba(64, 151, 242, 0.78), rgba(31, 101, 174, 0.68));
      box-shadow: 0 8px 18px rgba(15, 45, 82, 0.22);
    }

    body[data-overlay-visible="false"][data-overlay-edge="right"] .handle {
      left: 0;
      right: auto;
      top: 50%;
      border-radius: 999px 0 0 999px;
    }

    body[data-overlay-visible="false"][data-overlay-edge="left"] .handle {
      left: auto;
      right: 0;
      top: 50%;
      border-radius: 0 999px 999px 0;
    }

    body[data-overlay-visible="false"][data-overlay-edge="top"] .handle {
      left: 50%;
      right: auto;
      top: auto;
      bottom: 0;
      width: 96px;
      height: 12px;
      transform: translateX(-50%);
      border-radius: 0 0 999px 999px;
    }

    body[data-overlay-visible="false"][data-overlay-edge="bottom"] .handle {
      left: 50%;
      right: auto;
      top: 0;
      bottom: auto;
      width: 96px;
      height: 12px;
      transform: translateX(-50%);
      border-radius: 999px 999px 0 0;
    }
  </style>
</head>
<body data-overlay-visible="${visibleAttr}" data-overlay-edge="${edgeAttr}">
  <div class="overlay-state" aria-hidden="true">${visibleAttr}:${edgeAttr}</div>
  <div class="panel">
    <div class="card" id="card">
      <div class="handle"></div>
      <div class="topbar">
        <div class="brand">
          <span class="pulse"></span>
          <div class="title">Tabletop transfer station</div>
        </div>
        <div class="hint">拖动后自动吸附</div>
      </div>
      <div class="balance">
        <div class="label">${status}</div>
        <div class="amount">${balanceValue}</div>
      </div>
      <div class="grid">
        <div class="tile wide">
          <div class="label">余额详情</div>
          <div class="row">${detail}</div>
        </div>
        <div class="tile wide">
          <div class="label">订阅</div>
          <div class="row">${plan}</div>
        </div>
        <div class="tile">
          <div class="label">账号</div>
          <div class="row">${account}</div>
        </div>
        <div class="tile">
          <div class="label">邀请码</div>
          <div class="row">${invite}</div>
        </div>
      </div>
      <div class="keys">
        <div class="label">API Keys</div>
        <div class="row">${keys}</div>
      </div>
      <div class="resize-grip" id="resizeGrip" title="拖动调整大小"></div>
    </div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const card = document.getElementById('card');
    const resizeGrip = document.getElementById('resizeGrip');
    const overlayState = document.querySelector('.overlay-state');
    ipcRenderer.on('overlay-state', (_event, state) => {
      const visible = state && state.visible ? 'true' : 'false';
      const edge = state && state.edge ? state.edge : 'right';
      document.body.dataset.overlayVisible = visible;
      document.body.dataset.overlayEdge = edge;
      if (overlayState) overlayState.textContent = visible + ':' + edge;
    });
    card.addEventListener('mousedown', () => ipcRenderer.send('overlay-drag-start'));
    window.addEventListener('mouseup', () => ipcRenderer.send('overlay-drag-end'));
    resizeGrip.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      ipcRenderer.send('overlay-resize-start', {
        x: event.screenX,
        y: event.screenY
      });
    });
    window.addEventListener('mousemove', (event) => {
      if (event.buttons !== 1) return;
      ipcRenderer.send('overlay-resize-move', {
        x: event.screenX,
        y: event.screenY
      });
    });
    window.addEventListener('mouseup', () => ipcRenderer.send('overlay-resize-end'));
  </script>
</body>
</html>`;
}

module.exports = {
  buildOverlayRows,
  getOverlaySize,
  getDefaultOverlayPlacement,
  isCursorInOverlayRevealZone,
  shouldShowOverlayForCursor,
  getOverlayShapeRects,
  getNearestOverlayEdge,
  getOverlayPosition,
  getOverlayAnimationFrames,
  getOverlayMoveBounds,
  shouldTrackOverlayMove,
  shouldUpdateOverlaySizeFromBounds,
  shouldHandleOverlayResizeEvent,
  renderOverlayHtml
};

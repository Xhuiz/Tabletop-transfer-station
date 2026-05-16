const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildOverlayRows,
  getOverlaySize,
  getDefaultOverlayPlacement,
  isCursorInOverlayRevealZone,
  getNearestOverlayEdge,
  getOverlayPosition,
  getOverlayShapeRects,
  getOverlayAnimationFrames,
  getOverlayMoveBounds,
  shouldTrackOverlayMove,
  shouldUpdateOverlaySizeFromBounds,
  shouldHandleOverlayResizeEvent,
  shouldShowOverlayForCursor
} = require('./desktopOverlay');

test('buildOverlayRows keeps the tray balance fields in desktop order', () => {
  const rows = buildOverlayRows({
    balanceText: '余额: 85.39',
    detailText: '订阅￥0.00 / 按量￥85.39',
    planText: '当前订阅：SHARE ｜ 剩余17天',
    accountText: '账号: 19531238160',
    inviteCodeText: '邀请码: IUTQ27',
    keysText: 'API Keys: Claude Code:￥0.36 | codex:￥94.25'
  });

  assert.deepEqual(rows, [
    '状态: 余额: 85.39',
    '详情: 订阅￥0.00 / 按量￥85.39',
    '当前订阅：SHARE ｜ 剩余17天',
    '账号: 19531238160',
    '邀请码: IUTQ27',
    'API Keys: Claude Code:￥0.36 | codex:￥94.25'
  ]);
});

test('getOverlayPosition hides most of the window beyond the left desktop edge', () => {
  const position = getOverlayPosition({
    displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    windowBounds: { width: 680, height: 360 },
    edge: 'left',
    visible: false,
    margin: 24,
    peekSize: 8
  });

  assert.deepEqual(position, { x: -672, y: 24 });
});

test('getOverlayPosition slides the window out when visible', () => {
  const position = getOverlayPosition({
    displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    windowBounds: { width: 680, height: 360 },
    edge: 'left',
    visible: true,
    margin: 24,
    peekSize: 8
  });

  assert.deepEqual(position, { x: 24, y: 24 });
});

test('getNearestOverlayEdge picks the closest screen edge after dragging', () => {
  const displayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  const windowBounds = { x: 1200, y: 920, width: 420, height: 260 };

  assert.equal(getNearestOverlayEdge({ displayBounds, windowBounds }), 'bottom');
});

test('getOverlayPosition preserves drag offset when hidden on the right edge', () => {
  const position = getOverlayPosition({
    displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    windowBounds: { x: 1400, y: 300, width: 420, height: 260 },
    edge: 'right',
    visible: false,
    margin: 24,
    peekSize: 10
  });

  assert.deepEqual(position, { x: 1910, y: 300 });
});

test('getOverlayPosition preserves drag offset when visible on the bottom edge', () => {
  const position = getOverlayPosition({
    displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    windowBounds: { x: 620, y: 900, width: 420, height: 260 },
    edge: 'bottom',
    visible: true,
    margin: 24,
    peekSize: 10
  });

  assert.deepEqual(position, { x: 620, y: 796 });
});

test('getOverlayPosition hides against the real screen edge when work area is inset', () => {
  const displayBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  const visibleBounds = { x: 0, y: 24, width: 1920, height: 1056 };
  const windowBounds = { x: 800, y: 48, width: 280, height: 500 };

  assert.deepEqual(getOverlayPosition({
    displayBounds,
    visibleBounds,
    windowBounds,
    edge: 'top',
    visible: false,
    margin: 24,
    peekSize: 12
  }), { x: 800, y: -488 });

  assert.deepEqual(getOverlayPosition({
    displayBounds,
    visibleBounds,
    windowBounds,
    edge: 'top',
    visible: true,
    margin: 24,
    peekSize: 12
  }), { x: 800, y: 48 });
});

test('getOverlayAnimationFrames eases between hidden and visible positions', () => {
  const frames = getOverlayAnimationFrames({
    from: { x: 1910, y: 300 },
    to: { x: 1616, y: 300 },
    frameCount: 4
  });

  assert.deepEqual(frames, [
    { x: 1740, y: 300 },
    { x: 1653, y: 300 },
    { x: 1621, y: 300 },
    { x: 1616, y: 300 }
  ]);
});

test('getOverlayMoveBounds forces the configured size while moving', () => {
  assert.deepEqual(getOverlayMoveBounds({
    position: { x: 24, y: 24 },
    windowBounds: { width: 280, height: 500 }
  }), {
    x: 24,
    y: 24,
    width: 280,
    height: 500
  });
});

test('shouldTrackOverlayMove ignores hidden programmatic positions', () => {
  assert.equal(shouldTrackOverlayMove({
    overlayVisible: false,
    overlayProgrammaticMove: false,
    overlayResizeActive: false
  }), false);
  assert.equal(shouldTrackOverlayMove({
    overlayVisible: true,
    overlayProgrammaticMove: true,
    overlayResizeActive: false
  }), false);
  assert.equal(shouldTrackOverlayMove({
    overlayVisible: true,
    overlayProgrammaticMove: false,
    overlayResizeActive: false
  }), true);
});

test('shouldUpdateOverlaySizeFromBounds only allows explicit user resizing', () => {
  assert.equal(shouldUpdateOverlaySizeFromBounds({
    overlayResizeActive: false,
    overlayProgrammaticMove: true
  }), false);
  assert.equal(shouldUpdateOverlaySizeFromBounds({
    overlayResizeActive: false,
    overlayProgrammaticMove: false
  }), false);
  assert.equal(shouldUpdateOverlaySizeFromBounds({
    overlayResizeActive: true,
    overlayProgrammaticMove: false
  }), true);
});

test('shouldHandleOverlayResizeEvent ignores passive resize noise', () => {
  assert.equal(shouldHandleOverlayResizeEvent({
    overlayResizeActive: false,
    overlayProgrammaticMove: false
  }), false);
  assert.equal(shouldHandleOverlayResizeEvent({
    overlayResizeActive: true,
    overlayProgrammaticMove: true
  }), false);
  assert.equal(shouldHandleOverlayResizeEvent({
    overlayResizeActive: true,
    overlayProgrammaticMove: false,
    overlayEnforcingSize: true
  }), false);
  assert.equal(shouldHandleOverlayResizeEvent({
    overlayResizeActive: true,
    overlayProgrammaticMove: false
  }), true);
});

test('getOverlaySize is tall enough for the full dashboard card', () => {
  assert.deepEqual(getOverlaySize(), { width: 280, height: 500 });
});

test('getDefaultOverlayPlacement starts attached to the desktop upper right', () => {
  assert.deepEqual(getDefaultOverlayPlacement({
    displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    windowBounds: { width: 280, height: 500 },
    margin: 24
  }), {
    edge: 'right',
    bounds: { x: 1616, y: 24, width: 280, height: 500 }
  });
});

test('isCursorInOverlayRevealZone only triggers inside the compact hidden handle', () => {
  const options = {
    cursor: { x: 1914, y: 274 },
    displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    windowBounds: { x: 1908, y: 24, width: 280, height: 500 },
    edge: 'right',
    revealDistance: 42,
    handleSize: 96
  };

  assert.equal(isCursorInOverlayRevealZone(options), true);
  assert.equal(isCursorInOverlayRevealZone({
    ...options,
    cursor: { x: 1914, y: 140 }
  }), false);
  assert.equal(isCursorInOverlayRevealZone({
    ...options,
    cursor: { x: 1914, y: 410 }
  }), false);
});

test('shouldShowOverlayForCursor does not reveal from the full hidden peek strip', () => {
  const options = {
    cursor: { x: 1914, y: 140 },
    displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
    overlayBounds: { x: 1908, y: 24, width: 280, height: 500 },
    revealBounds: { x: 1908, y: 24, width: 280, height: 500 },
    edge: 'right',
    overlayVisible: false,
    revealDistance: 42,
    handleSize: 96
  };

  assert.equal(shouldShowOverlayForCursor(options), false);
  assert.equal(shouldShowOverlayForCursor({
    ...options,
    cursor: { x: 1914, y: 274 }
  }), true);
  assert.equal(shouldShowOverlayForCursor({
    ...options,
    overlayVisible: true
  }), true);
});

test('getOverlayShapeRects exposes only the compact handle while hidden on the right edge', () => {
  assert.deepEqual(getOverlayShapeRects({
    windowBounds: { width: 280, height: 500 },
    edge: 'right',
    visible: false,
    peekSize: 12,
    handleSize: 96
  }), [
    { x: 0, y: 202, width: 12, height: 96 }
  ]);
});

test('getOverlayShapeRects restores the full window shape while visible', () => {
  assert.deepEqual(getOverlayShapeRects({
    windowBounds: { width: 280, height: 500 },
    edge: 'right',
    visible: true,
    peekSize: 12,
    handleSize: 96
  }), [
    { x: 0, y: 0, width: 280, height: 500 }
  ]);
});

test('renderOverlayHtml includes a visible resize grip', () => {
  const html = require('./desktopOverlay').renderOverlayHtml([
    '状态: 余额: 79.85',
    '详情: 订阅￥0.00 / 按量￥79.85',
    '当前订阅：SHARE ｜ 剩余17天',
    '账号: -',
    '邀请码: -',
    'API Keys: -'
  ]);

  assert.match(html, /class="resize-grip"/);
  assert.match(html, /overlay-resize-start/);
});

test('renderOverlayHtml can render the hidden compact handle state', () => {
  const html = require('./desktopOverlay').renderOverlayHtml([
    'Status: Balance: 79.85',
    'Detail: subscription 50 / usage 29.85',
    'Plan: SHARE, 17 days left',
    'Account: -',
    'Invite: -',
    'API Keys: -'
  ], { visible: false, edge: 'right' });

  assert.match(html, /data-overlay-visible="false"/);
  assert.match(html, /data-overlay-edge="right"/);
  assert.match(html, /body\[data-overlay-visible="false"\]\s+\.card/);
  assert.match(html, /overlay-state/);
});

test('renderOverlayHtml updates visibility state over ipc without reloading', () => {
  const html = require('./desktopOverlay').renderOverlayHtml([
    'Status: Balance: 79.85',
    'Detail: subscription 50 / usage 29.85',
    'Plan: SHARE, 17 days left',
    'Account: -',
    'Invite: -',
    'API Keys: -'
  ]);

  assert.match(html, /ipcRenderer\.on\('overlay-state'/);
  assert.match(html, /document\.body\.dataset\.overlayVisible/);
  assert.match(html, /document\.body\.dataset\.overlayEdge/);
});

test('renderOverlayHtml makes the card flush with the overlay window edges', () => {
  const html = require('./desktopOverlay').renderOverlayHtml([
    '状态: 余额: 79.85',
    '详情: 订阅￥0.00 / 按量￥79.85',
    '当前订阅：SHARE ｜ 剩余17天',
    '账号: -',
    '邀请码: -',
    'API Keys: -'
  ]);

  assert.match(html, /body\s*{[\s\S]*?padding:\s*0;/);
  assert.match(html, /\.panel\s*{[\s\S]*?padding:\s*0;/);
  assert.match(html, /width:\s*100vw;/);
  assert.match(html, /height:\s*100vh;/);
});

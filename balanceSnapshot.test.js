const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBalanceSnapshot,
  hasSessionIdentity
} = require('./balanceSnapshot');

test('buildBalanceSnapshot keeps the legacy wallet money display', () => {
  const snapshot = buildBalanceSnapshot({
    walletData: {
      data: {
        balance: 8500,
        bonusBalance: 1200
      }
    },
    sessionData: {
      user: {
        id: 'u-1',
        phone: '13800000000',
        plan: 'Pro'
      }
    },
    keysData: {
      data: [
        { name: 'default', totalConsumed: 3400 }
      ]
    },
    profileData: {},
    inviteData: {
      data: {
        inviteCode: 'ABC'
      }
    },
    subWindow: {
      start: new Date(Date.now() - 86400000),
      expire: new Date(Date.now() + 2 * 86400000)
    },
    relayConfig: {
      urls: {
        inviteRegister: (code) => `https://relay.example.com/register?inviteCode=${code}`
      }
    }
  });

  assert.equal(snapshot.balanceText, '余额: 9.70');
  assert.equal(snapshot.detailText, '订阅￥8.50 / 按量￥1.20');
  assert.match(snapshot.planText, /^当前订阅：Pro ｜ 剩余[12]天$/);
  assert.equal(snapshot.keysText, 'API Keys: default:¥3.40');
  assert.equal(snapshot.accountText, '账号: 13800000000');
  assert.equal(snapshot.inviteCodeText, '邀请码: ABC');
  assert.equal(snapshot.inviteLink, 'https://relay.example.com/register?inviteCode=ABC');
});

test('buildBalanceSnapshot supports Xiaomi token plan credit payloads', () => {
  const snapshot = buildBalanceSnapshot({
    walletData: {
      code: 0,
      data: {
        planName: 'pro',
        totalCredits: 10000,
        expireTime: new Date(Date.now() + 5 * 86400000).toISOString()
      }
    },
    usageData: {
      code: 0,
      data: {
        usedCredits: 1250
      }
    },
    sessionData: {
      code: 0,
      data: {
        userId: 42,
        email: 'user@example.com'
      }
    },
    keysData: {
      code: 0,
      data: {
        apiKey: 'sk-live-secret'
      }
    },
    profileData: {},
    inviteData: {},
    subWindow: { start: null, expire: null },
    relayConfig: {
      urls: {
        inviteRegister: (code) => `https://platform.xiaomimimo.com/register?inviteCode=${code}`
      }
    }
  });

  assert.equal(snapshot.balanceText, '余额: 8,750 Credits');
  assert.equal(snapshot.detailText, '已用 1,250 / 总量 10,000 Credits');
  assert.match(snapshot.planText, /^当前订阅：pro ｜ 剩余[45]天$/);
  assert.equal(snapshot.keysText, 'API Keys: 已配置');
  assert.equal(snapshot.accountText, '账号: user@example.com');
});

test('buildBalanceSnapshot treats successful empty Xiaomi payloads as no subscription', () => {
  const snapshot = buildBalanceSnapshot({
    walletData: {
      code: 0,
      data: null
    },
    usageData: {
      code: 0,
      data: {}
    },
    sessionData: {
      code: 0,
      data: {
        phone: '+86 195****8160'
      }
    },
    keysData: {
      code: 0,
      data: null
    },
    profileData: {},
    inviteData: {},
    subWindow: { start: null, expire: null },
    relayConfig: {
      urls: {
        inviteRegister: (code) => `https://platform.xiaomimimo.com/register?inviteCode=${code}`
      }
    }
  });

  assert.equal(snapshot.balanceText, '余额: 暂无订阅');
  assert.equal(snapshot.detailText, '未开通 Token Plan');
  assert.equal(snapshot.planText, '当前订阅：暂无');
  assert.equal(snapshot.accountText, '账号: +86 195****8160');
});

test('buildBalanceSnapshot degrades when wallet is unavailable but account data exists', () => {
  const snapshot = buildBalanceSnapshot({
    walletData: null,
    usageData: null,
    sessionData: {
      user: {
        id: 'u-1',
        phone: '19531238160',
        plan: 'SHARE'
      }
    },
    keysData: {
      data: [
        { name: 'Claude Code', totalConsumed: 360 },
        { name: 'codex', totalConsumed: 159630 }
      ]
    },
    profileData: {},
    inviteData: {
      data: {
        inviteCode: 'IUTQ27'
      }
    },
    subWindow: { start: null, expire: null },
    relayConfig: {
      urls: {
        inviteRegister: (code) => `https://relay.example.com/register?inviteCode=${code}`
      }
    }
  });

  assert.equal(snapshot.balanceText, '余额: -');
  assert.equal(snapshot.detailText, '余额接口不可用');
  assert.equal(snapshot.planText, '当前订阅：SHARE');
  assert.equal(snapshot.accountText, '账号: 19531238160');
  assert.equal(snapshot.inviteCodeText, '邀请码: IUTQ27');
  assert.equal(snapshot.keysText, 'API Keys: Claude Code:¥0.36 | codex:¥159.63');
});

test('hasSessionIdentity accepts nested and flat user profile payloads', () => {
  assert.equal(hasSessionIdentity({ user: { id: 'u-1' } }), true);
  assert.equal(hasSessionIdentity({ code: 0, data: { userId: 42 } }), true);
  assert.equal(hasSessionIdentity({ code: 0, data: { email: 'user@example.com' } }), true);
  assert.equal(hasSessionIdentity({ code: 401, message: 'unauthorized' }), false);
});

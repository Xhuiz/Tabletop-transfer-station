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
        usedCredits: 1250,
        totalCredits: 10000,
        expireTime: new Date(Date.now() + 5 * 86400000).toISOString()
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

test('hasSessionIdentity accepts nested and flat user profile payloads', () => {
  assert.equal(hasSessionIdentity({ user: { id: 'u-1' } }), true);
  assert.equal(hasSessionIdentity({ code: 0, data: { userId: 42 } }), true);
  assert.equal(hasSessionIdentity({ code: 0, data: { email: 'user@example.com' } }), true);
  assert.equal(hasSessionIdentity({ code: 401, message: 'unauthorized' }), false);
});

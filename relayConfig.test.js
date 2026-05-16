const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  DEFAULT_RELAY_CONFIG,
  buildRelayConfig
} = require('./relayConfig');

test('buildRelayConfig uses neutral relay defaults without a user config', () => {
  const config = buildRelayConfig();

  assert.equal(config.baseUrl, DEFAULT_RELAY_CONFIG.baseUrl);
  assert.equal(config.urls.login, 'https://relay.example.com/login');
  assert.equal(config.urls.walletApi, 'https://relay.example.com/api/wallet');
  assert.deepEqual(config.urls.dashboardRscCandidates, [
    'https://relay.example.com/dashboard'
  ]);
});

test('buildRelayConfig supports replacing only the relay base url', () => {
  const config = buildRelayConfig({
    baseUrl: 'https://relay.example.com/'
  });

  assert.equal(config.baseUrl, 'https://relay.example.com');
  assert.equal(config.urls.login, 'https://relay.example.com/login');
  assert.equal(config.urls.dashboardWallet, 'https://relay.example.com/dashboard/wallet');
  assert.equal(config.urls.inviteRegister('CODE 1'), 'https://relay.example.com/register?inviteCode=CODE+1');
});

test('buildRelayConfig supports per-endpoint path overrides', () => {
  const config = buildRelayConfig({
    baseUrl: 'https://relay.example.com',
    paths: {
      walletApi: '/open/wallet',
      apiKeysApi: 'open/keys?page=1',
      dashboardRscCandidates: ['/panel?_rsc=abc', 'panel']
    }
  });

  assert.equal(config.urls.walletApi, 'https://relay.example.com/open/wallet');
  assert.equal(config.urls.apiKeysApi, 'https://relay.example.com/open/keys?page=1');
  assert.deepEqual(config.urls.dashboardRscCandidates, [
    'https://relay.example.com/panel?_rsc=abc',
    'https://relay.example.com/panel'
  ]);
});

test('buildRelayConfig can load relay.config.json from app and user locations', () => {
  const config = buildRelayConfig(null, {
    appConfigPath: path.join('app', 'relay.config.json'),
    userConfigPath: path.join('user', 'relay.config.json'),
    readJson: (filePath) => {
      if (filePath === path.join('app', 'relay.config.json')) {
        return { baseUrl: 'https://app.example.com' };
      }
      if (filePath === path.join('user', 'relay.config.json')) {
        return { baseUrl: 'https://user.example.com' };
      }
      return null;
    }
  });

  assert.equal(config.baseUrl, 'https://user.example.com');
  assert.deepEqual(config.loadedConfigPaths, [
    path.join('app', 'relay.config.json'),
    path.join('user', 'relay.config.json')
  ]);
});

test('buildRelayConfig rejects unsafe base urls', () => {
  assert.throws(() => buildRelayConfig({ baseUrl: 'ftp://relay.example.com' }), /HTTP/);
  assert.throws(() => buildRelayConfig({ baseUrl: 'not a url' }), /Invalid/);
});

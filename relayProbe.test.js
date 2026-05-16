const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildUCloudActionBody,
  buildUCloudActionUrl,
  getCookieHeaderValue,
  getUCloudConsoleAdapter,
  getUCloudRequestHeaders
} = require('./relayProbe');

test('getUCloudConsoleAdapter infers Compshare console API and passport hosts', () => {
  const adapter = getUCloudConsoleAdapter('https://console.compshare.cn/dashboard/wallet');

  assert.equal(adapter.name, 'ucloud-console');
  assert.equal(adapter.apiBaseUrl, 'https://api.compshare.cn');
  assert.equal(adapter.passportBaseUrl, 'https://passport.compshare.cn');
  assert.equal(adapter.loginUrl, 'https://passport.compshare.cn?service=https%3A%2F%2Fconsole.compshare.cn%2Fdashboard%2Fwallet#login');
  assert.deepEqual(adapter.cookieUrls, [
    'https://console.compshare.cn',
    'https://api.compshare.cn',
    'https://passport.compshare.cn'
  ]);
});

test('getUCloudConsoleAdapter handles dashed UCloud channel hosts', () => {
  const adapter = getUCloudConsoleAdapter('https://console-10086.ucloud.cn');

  assert.equal(adapter.apiBaseUrl, 'https://api-10086.ucloud.cn');
  assert.equal(adapter.passportBaseUrl, 'https://passport-10086.ucloud.cn');
});

test('getUCloudConsoleAdapter ignores ordinary relay domains', () => {
  assert.equal(getUCloudConsoleAdapter('https://relay.example.cn'), null);
});

test('buildUCloudActionUrl and body use the Action protocol expected by UCloud channels', () => {
  assert.equal(
    buildUCloudActionUrl('https://api.compshare.cn', 'GetBalance'),
    'https://api.compshare.cn/?Action=GetBalance'
  );
  assert.equal(
    buildUCloudActionBody('GetDataForConsoleVersion', { ingress: '1' }),
    'Action=GetDataForConsoleVersion&ingress=1'
  );
});

test('getUCloudRequestHeaders forwards CSRF and channel cookies without exposing auth secrets', () => {
  const cookies = [
    { name: 'CSRF_TOKEN', value: 'csrf-a' },
    { name: 'U_CSRF_TOKEN', value: 'csrf-b' },
    { name: 'channel_key', value: 'channel-1' },
    { name: 'session_token', value: 'secret-session' }
  ];

  assert.equal(getCookieHeaderValue(cookies, 'csrf_token'), 'csrf-a');
  assert.deepEqual(getUCloudRequestHeaders(cookies), {
    'CSRF-Token': 'csrf-a',
    'U-CSRF-Token': 'csrf-b',
    'channel-key': 'channel-1'
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { isLikelyAuthCookieName } = require('./authCookie');

test('isLikelyAuthCookieName accepts common relay session cookie names', () => {
  assert.equal(isLikelyAuthCookieName('next-auth.session-token'), true);
  assert.equal(isLikelyAuthCookieName('authjs.session-token'), true);
  assert.equal(isLikelyAuthCookieName('access_token'), true);
});

test('isLikelyAuthCookieName accepts Xiaomi platform auth cookie names', () => {
  assert.equal(isLikelyAuthCookieName('api-platform_ph'), true);
  assert.equal(isLikelyAuthCookieName('api-platform-st_ph'), true);
});

test('isLikelyAuthCookieName ignores analytics-only cookie names', () => {
  assert.equal(isLikelyAuthCookieName('_onetrack_token'), false);
  assert.equal(isLikelyAuthCookieName('cookie-preferences'), false);
});

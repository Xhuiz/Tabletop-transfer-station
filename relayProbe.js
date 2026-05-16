function normalizeOrigin(value) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must use HTTP or HTTPS.');
  }
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ''}`;
}

function getUCloudChannelHosts(hostname) {
  const normalizedHost = String(hostname || '').toLowerCase();
  if (!normalizedHost.startsWith('console.')) return null;
  const root = normalizedHost.slice('console.'.length);
  if (!root || !root.includes('.')) return null;
  return {
    consoleHost: normalizedHost,
    apiHost: `api.${root}`,
    passportHost: `passport.${root}`
  };
}

function getUCloudDashedChannelHosts(hostname) {
  const normalizedHost = String(hostname || '').toLowerCase();
  const match = normalizedHost.match(/^console-(.+)$/);
  if (!match) return null;
  return {
    consoleHost: normalizedHost,
    apiHost: `api-${match[1]}`,
    passportHost: `passport-${match[1]}`
  };
}

function getUCloudConsoleAdapter(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return null;
  }

  const hosts = getUCloudChannelHosts(parsed.hostname) || getUCloudDashedChannelHosts(parsed.hostname);
  if (!hosts) return null;

  const consoleBaseUrl = `https://${hosts.consoleHost}`;
  const apiBaseUrl = `https://${hosts.apiHost}`;
  const passportBaseUrl = `https://${hosts.passportHost}`;
  const dashboardWalletUrl = `${consoleBaseUrl}/dashboard/wallet`;

  return {
    name: 'ucloud-console',
    baseUrl: consoleBaseUrl,
    apiBaseUrl,
    passportBaseUrl,
    dashboardWalletUrl,
    loginUrl: `${passportBaseUrl}?service=${encodeURIComponent(dashboardWalletUrl)}#login`,
    cookieUrls: [
      consoleBaseUrl,
      apiBaseUrl,
      passportBaseUrl
    ]
  };
}

function buildUCloudActionUrl(apiBaseUrl, action) {
  const url = new URL(normalizeOrigin(apiBaseUrl));
  url.pathname = '/';
  url.searchParams.set('Action', action);
  return url.toString();
}

function buildUCloudActionBody(action, params = {}) {
  const body = new URLSearchParams();
  body.set('Action', action);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) body.set(key, String(value));
  });
  return body.toString();
}

function getCookieHeaderValue(cookies, name) {
  const target = String(name || '').toLowerCase();
  const found = (cookies || []).find((cookie) => String(cookie?.name || '').toLowerCase() === target);
  return found?.value || '';
}

function getUCloudRequestHeaders(cookies = []) {
  const headers = {};
  const csrfToken = getCookieHeaderValue(cookies, 'CSRF_TOKEN');
  const uCsrfToken = getCookieHeaderValue(cookies, 'U_CSRF_TOKEN');
  const channelKey = getCookieHeaderValue(cookies, 'channel_key');

  if (csrfToken) headers['CSRF-Token'] = csrfToken;
  if (uCsrfToken) headers['U-CSRF-Token'] = uCsrfToken;
  if (channelKey) headers['channel-key'] = channelKey;
  return headers;
}

module.exports = {
  buildUCloudActionBody,
  buildUCloudActionUrl,
  getCookieHeaderValue,
  getUCloudConsoleAdapter,
  getUCloudRequestHeaders
};

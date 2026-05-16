const fs = require('node:fs');

const DEFAULT_RELAY_CONFIG = {
  baseUrl: 'https://relay.example.com',
  paths: {
    login: '/login',
    dashboardWallet: '/dashboard/wallet',
    walletApi: '/api/wallet',
    sessionApi: '/api/auth/session',
    apiKeysApi: '/api/apikeys?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc',
    profileApi: '/api/user/profile',
    inviteInfoApi: '/api/user/invite/info',
    inviteRegister: '/register',
    dashboardRscCandidates: [
      '/dashboard'
    ]
  }
};

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Relay baseUrl must use HTTP or HTTPS.');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function mergeRelayConfig(baseConfig, overrideConfig) {
  if (!overrideConfig) return baseConfig;
  return {
    ...baseConfig,
    ...overrideConfig,
    paths: {
      ...(baseConfig.paths || {}),
      ...(overrideConfig.paths || {})
    }
  };
}

function joinUrl(baseUrl, routePath) {
  if (/^https?:\/\//i.test(routePath)) {
    return normalizeBaseUrl(routePath);
  }
  const normalizedPath = String(routePath || '').startsWith('/')
    ? String(routePath || '')
    : `/${routePath || ''}`;
  return `${baseUrl}${normalizedPath}`;
}

function buildUrls(baseUrl, paths) {
  return {
    login: joinUrl(baseUrl, paths.login),
    dashboardWallet: joinUrl(baseUrl, paths.dashboardWallet),
    walletApi: joinUrl(baseUrl, paths.walletApi),
    sessionApi: joinUrl(baseUrl, paths.sessionApi),
    apiKeysApi: joinUrl(baseUrl, paths.apiKeysApi),
    profileApi: joinUrl(baseUrl, paths.profileApi),
    inviteInfoApi: joinUrl(baseUrl, paths.inviteInfoApi),
    dashboardRscCandidates: (paths.dashboardRscCandidates || [])
      .map((candidate) => joinUrl(baseUrl, candidate)),
    inviteRegister: (inviteCode) => {
      const url = new URL(joinUrl(baseUrl, paths.inviteRegister));
      url.searchParams.set('inviteCode', inviteCode);
      return url.toString();
    }
  };
}

function buildRelayConfig(overrides = null, options = {}) {
  const {
    appConfigPath = null,
    userConfigPath = null,
    readJson = readJsonFile
  } = options;

  const loadedConfigPaths = [];
  let config = mergeRelayConfig({}, DEFAULT_RELAY_CONFIG);

  for (const filePath of [appConfigPath, userConfigPath]) {
    const fileConfig = readJson(filePath);
    if (fileConfig) {
      loadedConfigPaths.push(filePath);
      config = mergeRelayConfig(config, fileConfig);
    }
  }

  config = mergeRelayConfig(config, overrides);
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  return {
    ...config,
    baseUrl,
    loadedConfigPaths,
    urls: buildUrls(baseUrl, config.paths)
  };
}

module.exports = {
  DEFAULT_RELAY_CONFIG,
  buildRelayConfig
};

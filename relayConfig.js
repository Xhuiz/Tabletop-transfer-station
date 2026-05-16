const fs = require('node:fs');

const DEFAULT_RELAY_CONFIG = {
  baseUrl: 'https://relay.example.com',
  paths: {
    login: '/login',
    dashboardWallet: '/dashboard/wallet',
    walletApi: '/api/wallet',
    usageApi: '/api/wallet',
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

const RELAY_PRESETS = [
  {
    name: 'xiaomi-mimo',
    hosts: new Set([
      'platform.xiaomimimo.com',
      'token-plan-cn.xiaomimimo.com'
    ]),
    baseUrl: 'https://platform.xiaomimimo.com',
    paths: {
      login: '/login',
      dashboardWallet: '/console/balance',
      walletApi: '/api/v1/tokenPlan/detail',
      usageApi: '/api/v1/tokenPlan/usage',
      sessionApi: '/api/v1/userProfile',
      apiKeysApi: '/api/v1/tokenPlan/apiKey',
      profileApi: '/api/v1/userProfile',
      inviteInfoApi: '/api/v1/userProfile',
      inviteRegister: '/',
      dashboardRscCandidates: [
        '/console/balance'
      ]
    }
  }
];

function isPlaceholderRelayConfig(config) {
  const baseUrl = typeof config === 'string' ? config : config?.baseUrl;
  if (!baseUrl) return false;
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === 'example.com' || hostname.endsWith('.example.com');
  } catch {
    return false;
  }
}

function getRelayPreset(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    const normalizedHost = hostname.toLowerCase();
    return RELAY_PRESETS.find((preset) => preset.hosts.has(normalizedHost)) || null;
  } catch {
    return null;
  }
}

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

function isPresetName(name) {
  return RELAY_PRESETS.some((preset) => preset.name === name);
}

function stripStalePresetConfig(config) {
  if (!isPresetName(config?.preset)) return config;
  const preset = getRelayPreset(config.baseUrl);
  if (preset?.name === config.preset) return config;
  return {
    ...config,
    preset: undefined,
    paths: {
      ...DEFAULT_RELAY_CONFIG.paths
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
    usageApi: joinUrl(baseUrl, paths.usageApi || paths.walletApi),
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
  config = stripStalePresetConfig(config);
  let baseUrl = normalizeBaseUrl(config.baseUrl);
  const preset = getRelayPreset(baseUrl);
  if (preset) {
    config = mergeRelayConfig(config, {
      baseUrl: preset.baseUrl,
      paths: preset.paths,
      preset: preset.name
    });
    baseUrl = normalizeBaseUrl(preset.baseUrl);
  }

  return {
    ...config,
    baseUrl,
    loadedConfigPaths,
    urls: buildUrls(baseUrl, config.paths)
  };
}

module.exports = {
  DEFAULT_RELAY_CONFIG,
  RELAY_PRESETS,
  buildRelayConfig,
  getRelayPreset,
  isPlaceholderRelayConfig
};

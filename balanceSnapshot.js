function asFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function hasMeaningfulData(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function walkValues(root, visitor, seen = new Set()) {
  if (!root || typeof root !== 'object') return null;
  if (seen.has(root)) return null;
  seen.add(root);

  if (Array.isArray(root)) {
    for (const item of root) {
      const found = walkValues(item, visitor, seen);
      if (found !== null && found !== undefined) return found;
    }
    return null;
  }

  for (const [key, value] of Object.entries(root)) {
    const direct = visitor(key, value);
    if (direct !== null && direct !== undefined) return direct;
    if (value && typeof value === 'object') {
      const nested = walkValues(value, visitor, seen);
      if (nested !== null && nested !== undefined) return nested;
    }
  }
  return null;
}

function findNumberByKeys(root, keys) {
  const keySet = new Set(keys.map((key) => key.toLowerCase()));
  return walkValues(root, (key, value) => {
    if (!keySet.has(String(key).toLowerCase())) return null;
    return asFiniteNumber(value);
  });
}

function findStringByKeys(root, keys) {
  const keySet = new Set(keys.map((key) => key.toLowerCase()));
  return walkValues(root, (key, value) => {
    if (!keySet.has(String(key).toLowerCase())) return null;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  });
}

function findDateByKeys(root, keys) {
  const raw = findStringByKeys(root, keys) || findNumberByKeys(root, keys);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMoneyFromMilli(value) {
  return (value / 1000).toFixed(2);
}

function formatInteger(value) {
  if (!Number.isFinite(value)) return '-';
  return Math.max(0, Math.trunc(value)).toLocaleString('en-US');
}

function daysUntil(date) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / (24 * 3600 * 1000)));
}

function buildPlanText(plan, start, expire) {
  const label = plan || '-';
  const daysLeft = daysUntil(expire);
  if (start && expire && !Number.isNaN(start.getTime()) && daysLeft !== null) {
    return `当前订阅：${label} ｜ 剩余${daysLeft}天`;
  }
  if (daysLeft !== null) {
    return `当前订阅：${label} ｜ 剩余${daysLeft}天`;
  }
  return `当前订阅：${label}`;
}

function buildLegacyKeySummary(keysData) {
  const keyRows = Array.isArray(keysData?.data) ? keysData.data : [];
  return keyRows
    .map((key) => {
      const name = key?.name || '(未命名)';
      const total = Number(key?.totalConsumed || 0);
      const cny = Number.isFinite(total) ? formatMoneyFromMilli(total) : '0.00';
      return `${name}:¥${cny}`;
    })
    .join(' | ');
}

function buildGenericKeySummary(keysData) {
  const rows =
    Array.isArray(keysData?.data) ? keysData.data :
    Array.isArray(keysData?.data?.list) ? keysData.data.list :
    Array.isArray(keysData?.list) ? keysData.list :
    [];

  if (rows.length) {
    return rows
      .map((key, index) => key?.name || key?.label || key?.id || `Key ${index + 1}`)
      .join(' | ');
  }

  const apiKey = findStringByKeys(keysData, ['apiKey', 'apikey', 'key']);
  return apiKey ? '已配置' : '';
}

function getAccountText(sessionData, profileData) {
  const direct =
    sessionData?.user?.phone ||
    sessionData?.user?.email ||
    profileData?.user?.phone ||
    profileData?.user?.email ||
    findStringByKeys([sessionData, profileData], [
      'phone',
      'mobile',
      'email',
      'account',
      'username',
      'userName'
    ]) ||
    '-';
  return `账号: ${direct}`;
}

function getInviteInfo(inviteData, relayConfig) {
  const inviteCode =
    inviteData?.data?.inviteCode ||
    inviteData?.inviteCode ||
    findStringByKeys(inviteData, ['inviteCode', 'invitationCode']) ||
    '';
  const inviteLink =
    inviteData?.data?.inviteLink ||
    inviteData?.data?.inviteUrl ||
    inviteData?.inviteLink ||
    inviteData?.inviteUrl ||
    findStringByKeys(inviteData, ['inviteLink', 'inviteUrl', 'invitationUrl']) ||
    (inviteCode && relayConfig?.urls?.inviteRegister ? relayConfig.urls.inviteRegister(inviteCode) : '');

  return {
    inviteCodeText: inviteCode ? `邀请码: ${inviteCode}` : '邀请码: -',
    inviteLink: inviteLink || ''
  };
}

function buildLegacySnapshot(input) {
  const {
    walletData,
    sessionData,
    keysData,
    profileData,
    inviteData,
    subWindow,
    relayConfig
  } = input;

  const bal = asFiniteNumber(walletData?.data?.balance);
  const bonus = asFiniteNumber(walletData?.data?.bonusBalance);
  if (bal === null && bonus === null) return null;

  const balValue = bal ?? 0;
  const bonusValue = bonus ?? 0;
  const total = balValue + bonusValue;
  const keySummary = buildLegacyKeySummary(keysData);
  const invite = getInviteInfo(inviteData, relayConfig);
  const plan = sessionData?.user?.plan || '-';

  return {
    balanceText: `余额: ${formatMoneyFromMilli(total)}`,
    detailText: `订阅￥${bal === null ? '-' : formatMoneyFromMilli(balValue)} / 按量￥${bonus === null ? '-' : formatMoneyFromMilli(bonusValue)}`,
    planText: buildPlanText(plan, subWindow?.start || null, subWindow?.expire || null),
    keysText: keySummary ? `API Keys: ${keySummary}` : 'API Keys: -',
    accountText: getAccountText(sessionData, profileData),
    inviteCodeText: invite.inviteCodeText,
    inviteLink: invite.inviteLink
  };
}

function buildCreditSnapshot(input) {
  const {
    walletData,
    usageData,
    sessionData,
    keysData,
    profileData,
    inviteData,
    subWindow,
    relayConfig
  } = input;

  const sourceData = [walletData, usageData];
  const total = findNumberByKeys(sourceData, [
    'totalCredits',
    'totalCredit',
    'totalCreditAmount',
    'creditLimit',
    'totalTokens',
    'tokenLimit',
    'totalToken',
    'limitCredits',
    'maxCredits',
    'maxCredit',
    'limit',
    'quota',
    'total'
  ]);
  const used = findNumberByKeys(sourceData, [
    'usedCredits',
    'usedCredit',
    'usedCreditAmount',
    'creditUsed',
    'usedTokens',
    'usedToken',
    'usedTokenAmount',
    'consumedCredits',
    'consumedCredit',
    'usageCredits',
    'usageCredit',
    'usedAmount',
    'totalUsage',
    'usage',
    'used',
    'consumed'
  ]);
  let remaining = findNumberByKeys(sourceData, [
    'remainingCredits',
    'remainingCredit',
    'remainCredits',
    'remainCredit',
    'remainCreditAmount',
    'availableCredits',
    'availableCredit',
    'availableCreditAmount',
    'leftCredits',
    'leftCredit',
    'creditBalance',
    'balanceCredits',
    'balanceCredit',
    'remaining',
    'remain',
    'available'
  ]);

  if (remaining === null && total !== null && used !== null) {
    remaining = total - used;
  }

  if (remaining === null && total === null && used === null) return null;

  const plan =
    findStringByKeys(sourceData, [
      'planName',
      'planType',
      'packageName',
      'subscriptionName',
      'level',
      'name'
    ]) ||
    findStringByKeys(sessionData, ['plan', 'planName']) ||
    '-';
  const start = subWindow?.start || findDateByKeys(sourceData, ['startTime', 'startAt', 'periodStart']);
  const expire = subWindow?.expire || findDateByKeys(sourceData, [
    'expireTime',
    'expiresAt',
    'expiredAt',
    'validUntil',
    'endTime',
    'endAt',
    'periodEnd',
    'subscriptionExpiresAt'
  ]);
  const keySummary = buildGenericKeySummary(keysData);
  const invite = getInviteInfo(inviteData, relayConfig);

  const detailParts = [];
  if (used !== null) detailParts.push(`已用 ${formatInteger(used)}`);
  if (total !== null) detailParts.push(`总量 ${formatInteger(total)}`);

  return {
    balanceText: `余额: ${formatInteger(remaining ?? Math.max(0, (total ?? 0) - (used ?? 0)))} Credits`,
    detailText: detailParts.length ? `${detailParts.join(' / ')} Credits` : 'Token Plan Credits',
    planText: buildPlanText(plan, start, expire),
    keysText: keySummary ? `API Keys: ${keySummary}` : 'API Keys: -',
    accountText: getAccountText(sessionData, profileData),
    inviteCodeText: invite.inviteCodeText,
    inviteLink: invite.inviteLink
  };
}

function buildEmptySubscriptionSnapshot(input) {
  const {
    walletData,
    usageData,
    sessionData,
    profileData,
    keysData,
    inviteData,
    relayConfig
  } = input;

  const walletCode = walletData?.code ?? walletData?.status;
  const usageCode = usageData?.code ?? usageData?.status;
  const walletPayload = isObject(walletData) && 'data' in walletData ? walletData.data : walletData;
  const usagePayload = isObject(usageData) && 'data' in usageData ? usageData.data : usageData;
  const looksSuccessful =
    walletCode === 0 || walletCode === 200 || usageCode === 0 || usageCode === 200;
  if (!looksSuccessful || hasMeaningfulData(walletPayload) || hasMeaningfulData(usagePayload)) return null;

  const keySummary = buildGenericKeySummary(keysData);
  const invite = getInviteInfo(inviteData, relayConfig);

  return {
    balanceText: '余额: 暂无订阅',
    detailText: '未开通 Token Plan',
    planText: '当前订阅：暂无',
    keysText: keySummary ? `API Keys: ${keySummary}` : 'API Keys: -',
    accountText: getAccountText(sessionData, profileData),
    inviteCodeText: invite.inviteCodeText,
    inviteLink: invite.inviteLink
  };
}

function buildBalanceSnapshot(input) {
  return buildLegacySnapshot(input) ||
    buildCreditSnapshot(input) ||
    buildEmptySubscriptionSnapshot(input) ||
    {
      balanceText: '余额: -',
      detailText: '未识别余额接口返回结构',
      planText: '当前订阅：-',
      keysText: 'API Keys: -',
      accountText: getAccountText(input.sessionData, input.profileData),
      inviteCodeText: '邀请码: -',
      inviteLink: ''
    };
}

function hasSessionIdentity(data) {
  if (data?.user?.id || data?.user?.phone || data?.user?.email) return true;
  if (data?.code === 401 || data?.status === 401) return false;
  return !!findStringByKeys(data, ['id', 'userId', 'uid', 'phone', 'mobile', 'email']);
}

module.exports = {
  buildBalanceSnapshot,
  hasSessionIdentity
};

const AUTH_COOKIE_NAMES = new Set([
  'api-platform_ph',
  'api-platform-st_ph',
  'api-platform-pre_ph',
  'u_company_id',
  'csrf_token',
  'u_csrf_token'
]);

function isLikelyAuthCookieName(name) {
  const normalized = String(name || '').toLowerCase();
  if (!normalized) return false;
  if (AUTH_COOKIE_NAMES.has(normalized)) return true;
  if (normalized.startsWith('_onetrack_')) return false;
  return normalized.includes('session') ||
    normalized.includes('authjs') ||
    normalized.includes('access_token') ||
    normalized.includes('refresh_token') ||
    normalized === 'token';
}

module.exports = {
  isLikelyAuthCookieName
};

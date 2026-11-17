/** Only two explicit, loopback test targets are permitted. Never accept arbitrary DB names. */
export function testTarget(env = process.env) {
  if (env.GITHUB_ACTIONS === 'true' && env.CI !== 'true') throw new Error('GitHub Actions must use the explicit CI test target.');
  const ci = env.GITHUB_ACTIONS === 'true' && env.CI === 'true';
  const expected = ci ? { database: 'jobflow_ci', role: 'jobflow_ci_app' } : { database: 'jobflow_db', role: 'jobflow_app' };
  let url;
  try { url = new URL(env.DATABASE_URL ?? ''); } catch { throw new Error('Test database configuration is missing or invalid; value suppressed.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || (url.port || '5432') !== '5432' || decodeURIComponent(url.pathname) !== `/${expected.database}`
    || decodeURIComponent(url.username) !== expected.role || url.hash
    || [...url.searchParams.keys()].some((key) => !['schema', 'connection_limit', 'pool_timeout', 'connect_timeout', 'sslmode'].includes(key))
    || (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')) throw new Error('Refusing tests: database target is outside the explicit local/CI allowlist.');
  return { ...expected, ci, url: url.href };
}

export function testOrigin(value = 'http://127.0.0.1:3017') {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid local HTTP test origin.'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !url.port) throw new Error('HTTP tests require an explicit loopback origin and port.');
  return url;
}

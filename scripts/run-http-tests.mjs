import { createConnection } from 'node:net';
import { createWriteStream, mkdirSync } from 'node:fs';
import { finished } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import nextEnv from '@next/env';
import { testOrigin, testTarget } from './lib/test-target.mjs';
import { runNode, startNode, stopNode } from './lib/process.mjs';

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => { throw new Error('Cannot load test configuration.'); } });
testTarget(); // Never start a server connected to an arbitrary database.
const origin = testOrigin(process.env.API_BASE_URL);
const bindHost = origin.hostname.replaceAll('[', '').replaceAll(']', '');
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const env = { ...process.env, API_BASE_URL: origin.origin, BETTER_AUTH_URL: origin.origin, QQ_SMTP_USER: '', QQ_SMTP_AUTH_CODE: '', NEXT_TELEMETRY_DISABLED: '1' };
let server; let log;
async function assertUnusedPort() {
  const open = await new Promise((resolve) => {
    const socket = createConnection({ host: bindHost, port: Number(origin.port) });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
  });
  if (open) throw new Error('Test port is already occupied; no existing process was stopped.');
}
async function ready() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    controller.signal.throwIfAborted();
    if (server.child.exitCode !== null || server.child.signalCode !== null) throw new Error('Next.js test server exited before readiness; inspect .qa/http-server.log.');
    try {
      const response = await fetch(new URL('/api/health', origin), { signal: AbortSignal.timeout(1000), redirect: 'error' });
      const body = await response.json();
      if (response.ok && body.status === 'ok' && body.service === 'jobflow') return;
    } catch { /* Startup is bounded; a failed health check never runs tests. */ }
    await delay(250, undefined, { signal: controller.signal });
  }
  throw new Error('Next.js test server readiness timed out; inspect .qa/http-server.log.');
}
try {
  await assertUnusedPort();
  mkdirSync('.qa', { recursive: true }); log = createWriteStream('.qa/http-server.log');
  server = startNode(['node_modules/next/dist/bin/next', 'start', '--hostname', bindHost, '--port', origin.port], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.child.stdout.pipe(log, { end: false }); server.child.stderr.pipe(log, { end: false });
  await ready();
  console.log(`Owned Next.js server ready at ${origin.origin}; SMTP credentials cleared.`);
  await runNode(['--test', 'tests/api.test.mjs'], env, controller.signal);
  const suites = ['auth-http', 'jobs-http', 'job-import-http'];
  for (const [index, suite] of suites.entries()) {
    if (index) {
      console.log('Waiting 11 seconds for the existing password-registration rate-limit window.');
      await delay(11000, undefined, { signal: controller.signal });
    }
    await runNode(['--conditions=react-server', '--import', 'tsx', '--test', `tests/${suite}.test.ts`], env, controller.signal);
  }
} catch (error) {
  console.error(controller.signal.aborted ? 'HTTP test run interrupted.' : error instanceof Error ? error.message : 'HTTP tests failed.');
  process.exitCode = 1;
} finally {
  if (server) { await stopNode(server); console.log('Owned Next.js test process stopped.'); }
  if (log) { log.end(); await finished(log); }
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
}

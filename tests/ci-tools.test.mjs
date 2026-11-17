import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testTarget, testOrigin } from '../scripts/lib/test-target.mjs';
import { startNode, stopNode } from '../scripts/lib/process.mjs';

const local = 'postgresql://jobflow_app:TEST_ONLY@127.0.0.1:5432/jobflow_db?schema=public';
test('测试目标保留本地白名单，CI只允许独立数据库和应用角色', () => {
  assert.equal(testTarget({ DATABASE_URL: local }).database, 'jobflow_db');
  const env = { CI: 'true', GITHUB_ACTIONS: 'true', DATABASE_URL: local };
  assert.throws(() => testTarget(env));
  assert.throws(() => testTarget({ ...env, CI: 'false' }));
  assert.equal(testTarget({ ...env, DATABASE_URL: 'postgresql://jobflow_ci_app:TEST_ONLY@127.0.0.1:5432/jobflow_ci' }).database, 'jobflow_ci');
});
test('外部主机、管理员、替代连接参数和生产名称都被拒绝', () => {
  for (const value of [local.replace('127.0.0.1', 'db.example.com'), local.replace('jobflow_app:', 'postgres:'), local.replace('/jobflow_db', '/production'), local + '&host=other', local.replace(':5432', ':5433')]) assert.throws(() => testTarget({ DATABASE_URL: value }));
});
test('HTTP测试必须使用明确loopback端口，拒绝外部地址和URL凭据', () => {
  assert.equal(testOrigin().port, '3017');
  for (const value of ['https://example.com:3017', 'http://user:pass@localhost:3017', 'http://localhost', 'http://localhost:3017/other']) assert.throws(() => testOrigin(value));
});
test('拥有的Node子进程可清理，重复清理不会影响其他进程', async () => {
  const process = startNode(['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await new Promise((resolve, reject) => { process.child.once('spawn', resolve); process.child.once('error', reject); });
  await stopNode(process); await stopNode(process);
  assert.ok(process.child.exitCode !== null || process.child.signalCode !== null);
});

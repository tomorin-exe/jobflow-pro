import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import nextEnv from '@next/env';

function git(args, input) {
  const result = spawnSync('git', args, { input, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error('Git audit command failed; raw output suppressed.');
  return result.stdout;
}
const paths = (args) => git(args).toString('utf8').split('\0').filter(Boolean);
const working = paths(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
const staged = paths(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => { throw new Error('Cannot load local audit configuration.'); } });
const privateValues = [];
for (const key of ['BETTER_AUTH_SECRET', 'QQ_SMTP_AUTH_CODE', 'QQ_SMTP_USER']) {
  const value = process.env[key];
  if (value && value.length >= 8 && !/REPLACE|YOUR_|CHANGE_ME|your_mailbox/.test(value)) privateValues.push([key, value]);
}
if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);
    privateValues.push(['DATABASE_URL', process.env.DATABASE_URL]);
    const password = decodeURIComponent(url.password);
    if (password.length >= 8 && !/YOUR_|TEST_|PLACEHOLDER/.test(password)) privateValues.push(['database password', password]);
  } catch { throw new Error('Invalid database configuration; value suppressed.'); }
}
const findings = new Set();
const forbidden = (path) => /(^|\/)(\.env(?:\..*)?|\.qa|\.playwright-mcp|node_modules|\.next|coverage|test-results|playwright-report|backups)(\/|$)/i.test(path) && !/(^|\/)\.env\.example$/.test(path)
  || /\.(dump|backup|pgdump|pfx|p12|pem|key|log|tsbuildinfo)$/i.test(path)
  || /(^|\/)[^/]*(backup|dump)[^/]*\.sql$/i.test(path);
function inspect(label, path, bytes) {
  if (forbidden(path)) findings.add(`${label}: sensitive/artifact path ${path}`);
  const text = bytes.toString('utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}|\bnpm_[A-Za-z0-9]{30,}|\bAKIA[A-Z0-9]{16}\b/.test(text)) findings.add(`${label}: credential pattern in ${path}`);
  for (const match of text.matchAll(/(?:BETTER_AUTH_SECRET|QQ_SMTP_AUTH_CODE)\s*[:=]\s*["']([^"'\r\n]+)["']/g)) {
    if (match[1].length >= 8 && !/REPLACE|YOUR_|CHANGE_ME|TEST|FAKE|fixture|PRIVATE|\$\{|你|占位|授权码/i.test(match[1])) findings.add(`${label}: review literal authentication/SMTP credential in ${path} (value redacted)`);
  }
  if (/\b\d{5,12}@(?:qq|foxmail)\.com\b/i.test(text)) findings.add(`${label}: review possible private email in ${path} (address redacted)`);
  for (const [key, value] of privateValues) if (text.includes(value) || text.includes(encodeURIComponent(value))) findings.add(`${label}: possible local ${key} match in ${path} (value redacted)`);
}
for (const path of new Set(working)) if (existsSync(path)) inspect('working', path, readFileSync(path));
for (const path of staged) inspect('index', path, git(['show', `:${path}`]));

// Batch-read all reachable objects. Never print blob contents, commit identities or secrets.
const objects = git(['rev-list', '--objects', '--all']).toString('utf8').trim().split('\n').filter(Boolean).map((line) => ({ oid: line.slice(0, 40), path: line.slice(41) }));
const data = git(['cat-file', '--batch'], objects.map(({ oid }) => oid).join('\n') + '\n');
let offset = 0; let blobs = 0; let commits = 0; let privateIdentityCommits = 0;
for (const entry of objects) {
  const end = data.indexOf(10, offset);
  const [, type, length] = data.subarray(offset, end).toString('utf8').split(' ');
  const size = Number(length);
  if (!Number.isSafeInteger(size)) throw new Error('Cannot parse Git audit batch.');
  const bytes = data.subarray(end + 1, end + 1 + size);
  offset = end + 1 + size + 1;
  if (type === 'blob') { blobs++; inspect('history', entry.path || '(unnamed blob)', bytes); }
  if (type === 'commit') {
    commits++;
    const messageStart = bytes.indexOf('\n\n');
    if (messageStart >= 0) inspect('history commit message', entry.oid.slice(0, 8), bytes.subarray(messageStart + 2));
    if (bytes.toString('utf8').split('\n').some((line) => /^(author|committer) /.test(line) && /<[^>]+@[^>]+>/.test(line) && !/@users\.noreply\.github\.com>/.test(line))) privateIdentityCommits++;
  }
}
console.log(JSON.stringify({ workingFiles: new Set(working).size, stagedFiles: staged.length, historyCommits: commits, historyBlobs: blobs, findings: [...findings], imagesForManualReview: working.filter((path) => /\.(png|jpe?g|webp|gif)$/i.test(path)), identityPrivacyWarningCommits: privateIdentityCommits }, null, 2));
if (privateIdentityCommits) console.log('History contains non-noreply author/committer email metadata; values are not printed. Review privacy before publishing. History was not rewritten.');
if (findings.size) process.exitCode = 1;

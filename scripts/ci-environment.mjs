import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true' || process.platform !== 'linux' || !process.env.GITHUB_ENV) throw new Error('CI environment setup is restricted to the Linux GitHub Actions runner.');
const password = randomBytes(32).toString('hex');
const secret = randomBytes(48).toString('hex');
for (const value of [password, secret]) console.log(`::add-mask::${value}`);
appendFileSync(process.env.GITHUB_ENV, [
  `DATABASE_URL=postgresql://jobflow_ci_app:${password}@127.0.0.1:5432/jobflow_ci?schema=public`,
  `BETTER_AUTH_SECRET=${secret}`, `CI_DB_MARKER=${randomUUID()}`,
  'BETTER_AUTH_URL=http://127.0.0.1:3017', 'API_BASE_URL=http://127.0.0.1:3017',
  'QQ_SMTP_USER=', 'QQ_SMTP_AUTH_CODE=', '',
].join('\n'));
console.log('Generated disposable CI database/authentication configuration; no repository secrets used.');

import { runNode } from './lib/process.mjs';

const env = { ...process.env, QQ_SMTP_USER: '', QQ_SMTP_AUTH_CODE: '' };
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
try {
  // Preserve each suite's original Node conditions; serialize for reproducibility.
  const suites = [
    ['tests/ci-tools.test.mjs'],
    ['tests/database.test.ts', 'tests/job-repository.test.ts', 'tests/auth.test.ts', 'tests/auth-form.test.ts'],
    ['tests/job-api.test.ts'], ['tests/remote-jobs.test.ts'], ['tests/job-csv.test.ts'],
    ['tests/job-import-unit.test.ts'], ['tests/job-import.test.ts'], ['tests/otp-form.test.ts', 'tests/email-otp.test.ts'],
  ];
  const clientSuites = new Set(['tests/remote-jobs.test.ts', 'tests/job-csv.test.ts']);
  for (const files of suites) {
    const typescript = files.some((file) => file.endsWith('.ts'));
    const server = typescript && !files.every((file) => clientSuites.has(file));
    await runNode([...(server ? ['--conditions=react-server'] : []), ...(typescript ? ['--import', 'tsx'] : []), '--test', '--test-concurrency=1', ...files], env, controller.signal);
  }
  await runNode(['scripts/run-http-tests.mjs'], env, controller.signal);
} catch (error) {
  console.error(controller.signal.aborted ? 'Test run interrupted.' : error instanceof Error ? error.message : 'Tests failed.');
  process.exitCode = 1;
} finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }

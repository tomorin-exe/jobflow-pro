import pg from 'pg';
import { testTarget } from './lib/test-target.mjs';
import { runNode } from './lib/process.mjs';

const mode = process.argv[2];
const target = testTarget();
if (!target.ci || process.platform !== 'linux' || !['prepare', 'migrate'].includes(mode) || !/^[0-9a-f-]{36}$/.test(process.env.CI_DB_MARKER ?? '')) throw new Error('CI database commands are restricted to the marked Linux GitHub Actions test database.');
const marker = `jobflow-disposable-ci:${process.env.CI_DB_MARKER}`;
let client;
try {
  if (mode === 'prepare') {
    const password = process.env.CI_BOOTSTRAP_PASSWORD;
    if (!password || !/^jobflow-service-[0-9]+-[0-9]+$/.test(password)) throw new Error();
    client = new pg.Client({ host: '127.0.0.1', port: 5432, database: 'postgres', user: 'jobflow_ci_admin', password, connectionTimeoutMillis: 5000 });
    await client.connect();
    const { rows: [admin] } = await client.query("SELECT current_database() AS db, current_user AS role, current_setting('server_version_num')::int AS version");
    if (admin.db !== 'postgres' || admin.role !== 'jobflow_ci_admin' || admin.version < 180000 || admin.version >= 190000) throw new Error();
    const existing = await client.query("SELECT datname FROM pg_database WHERE datname = 'jobflow_ci' UNION ALL SELECT rolname FROM pg_roles WHERE rolname = 'jobflow_ci_app'");
    if (existing.rowCount) throw new Error(); // Never drop/reuse an existing database or role.
    const appPassword = decodeURIComponent(new URL(target.url).password);
    if (!/^[0-9a-f]{64}$/.test(appPassword)) throw new Error();
    await client.query(`CREATE ROLE jobflow_ci_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
    await client.query('CREATE DATABASE jobflow_ci OWNER jobflow_ci_app');
    await client.query(`COMMENT ON DATABASE jobflow_ci IS '${marker}'`);
    console.log('Created a new disposable jobflow_ci database and non-admin application role.');
  } else {
    client = new pg.Client({ connectionString: target.url, connectionTimeoutMillis: 5000 });
    await client.connect();
    const { rows: [identity] } = await client.query("SELECT current_database() AS db, current_user AS role, host(inet_server_addr()) AS host, inet_server_port() AS port, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser, shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()");
    // Docker port forwarding reaches a container-private server address, not 127.0.0.1.
    // The client URL is loopback-only; the database marker binds this fresh service to the job.
    if (!identity || identity.db !== target.database || identity.role !== target.role || identity.port !== 5432 || identity.superuser || identity.marker !== marker) throw new Error();
    console.log('Verified the job-specific disposable database marker; applying committed migrations only.');
    await runNode(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], process.env);
  }
} catch {
  console.error('CI database setup/migration failed or target was refused; raw connection/SQL details suppressed.');
  process.exitCode = 1;
} finally { if (client) await client.end().catch(() => {}); }

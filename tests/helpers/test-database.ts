import assert from "node:assert/strict";
import { testTarget } from "../../scripts/lib/test-target.mjs";
import { getPrisma } from "@/lib/prisma";
import { withDatabaseErrors } from "@/lib/database-error";

/** Env files are loaded by each existing suite; explicit CI env takes precedence. */
export async function assertTestDatabase() {
  const expected = testTarget();
  const [actual] = await withDatabaseErrors(() => getPrisma().$queryRaw<{
    database: string; role: string; address: string; port: number; version: string; superuser: boolean; marker: string | null;
  }[]>`SELECT current_database() AS database, current_user AS role,
    host(inet_server_addr()) AS address, inet_server_port() AS port,
    current_setting('server_version') AS version,
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
    (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = current_database()) AS marker`);
  assert.ok(actual && actual.database === expected.database && actual.role === expected.role
    && (expected.ci ? actual.marker === `jobflow-disposable-ci:${process.env.CI_DB_MARKER}` : ["127.0.0.1", "::1"].includes(actual.address))
    && actual.port === 5432 && !actual.superuser,
  "测试只允许明确的 loopback 应用数据库和非管理员账号。");
  return actual;
}

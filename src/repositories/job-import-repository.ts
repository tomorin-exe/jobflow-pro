import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { AuthError } from "@/lib/auth-error";
import { DatabaseAccessError } from "@/lib/database-error";
import { detectJobDuplicates, jobDuplicateKey, parseJobCsv, selectedDuplicateLines, CSV_MAX_ROWS } from "@/lib/job-csv";
import { JobImportError } from "@/lib/job-import-error";
import { toJobWriteData } from "@/lib/job-mapper";
import { isJobStatus } from "@/lib/jobs";
import { getPrisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import type { CsvRow, ImportPreview, JobImportRequest, JobImportResult } from "@/types/job-import";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type ImportTransaction = Pick<Prisma.TransactionClient, "job" | "jobImportBatch" | "$queryRaw">;
type ImportDatabase = {
  job: Prisma.TransactionClient["job"];
  $transaction<T>(work: (tx: ImportTransaction) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }): Promise<T>;
};
type DuplicateJob = { id: string; company: string; position: string; location: string };

function preview(csv: string, rows: CsvRow[], existing: DuplicateJob[]): ImportPreview {
  const keys = new Set(rows.filter((row) => !row.errors.length).map((row) => jobDuplicateKey(row.input)));
  // 只对与本 CSV 有关的当前用户记录签版本指纹；其他岗位的变化不使预览失效。
  const matches = existing.filter((job) => keys.has(jobDuplicateKey(job))).map((job) => [job.id, jobDuplicateKey(job)]).sort((a, b) => a[0].localeCompare(b[0]));
  return { rows: detectJobDuplicates(rows, existing), previewHash: digest(JSON.stringify([digest(csv), matches])) };
}
function requestInput(value: unknown): JobImportRequest {
  if (typeof value !== "object" || value === null) throw new JobImportError("IMPORT_INVALID");
  const body = value as Record<string, unknown>;
  if (typeof body.csv !== "string" || typeof body.allowDuplicates !== "boolean"
    || typeof body.previewHash !== "string" || !/^[a-f0-9]{64}$/.test(body.previewHash)
    || typeof body.requestId !== "string" || !uuid.test(body.requestId)
    || !Array.isArray(body.selectedRows) || !body.selectedRows.length || body.selectedRows.length > CSV_MAX_ROWS
    || !body.selectedRows.every((line) => Number.isSafeInteger(line) && line > 1)
    || new Set(body.selectedRows).size !== body.selectedRows.length) throw new JobImportError("IMPORT_INVALID");
  // 显式白名单：不将 userId、id 或客户端校验结果带到数据库。
  return { csv: body.csv, allowDuplicates: body.allowDuplicates, previewHash: body.previewHash, requestId: body.requestId.toLowerCase(), selectedRows: [...body.selectedRows].sort((a: number, b: number) => a - b) };
}
async function safeImport<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof JobImportError || error instanceof AuthError || error instanceof DatabaseAccessError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") throw new JobImportError("IMPORT_MIGRATION_REQUIRED");
    throw new DatabaseAccessError("DATABASE_UNAVAILABLE");
  }
}

/** 服务端专用；身份只能来自 Session 或受信任的测试注入。 */
export function createJobImportRepository(getDatabase: () => ImportDatabase = getPrisma, resolveUserId: () => Promise<string> = requireUserId) {
  async function owner() {
    const userId = await resolveUserId();
    if (!uuid.test(userId)) throw new AuthError("UNAUTHORIZED");
    return userId;
  }
  const existingJobs = (db: Pick<Prisma.TransactionClient, "job">, userId: string) => db.job.findMany({ where: { userId }, select: { id: true, company: true, position: true, location: true } });
  return {
    async preview(csv: unknown): Promise<ImportPreview> {
      const userId = await owner();
      if (typeof csv !== "string") throw new JobImportError("CSV_INVALID");
      const rows = parseJobCsv(csv);
      return safeImport(async () => preview(csv, rows, await existingJobs(getDatabase(), userId)));
    },
    async import(value: unknown): Promise<JobImportResult> {
      const userId = await owner();
      const input = requestInput(value);
      const rows = parseJobCsv(input.csv);
      const selected = input.selectedRows.map((line) => rows.find((row) => row.line === line));
      if (selected.some((row) => !row || row.errors.length)) throw new JobImportError("IMPORT_INVALID");
      const requestHash = digest(JSON.stringify([input.csv, input.selectedRows, input.allowDuplicates]));
      return safeImport(() => getDatabase().$transaction(async (tx) => {
        // 参数化行锁：同一用户的不同导入/同批重试串行，不阻塞其他用户的导入。
        const owners = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        if (!owners.length) throw new AuthError("UNAUTHORIZED");
        const batch = await tx.jobImportBatch.findUnique({ where: { userId_requestId: { userId, requestId: input.requestId } } });
        if (batch) {
          if (batch.requestHash !== requestHash) throw new JobImportError("IMPORT_KEY_CONFLICT");
          return { batchId: batch.id, importedCount: batch.jobIds.length, jobIds: batch.jobIds, rowNumbers: batch.rowNumbers, replayed: true };
        }
        const current = preview(input.csv, rows, await existingJobs(tx, userId));
        if (current.previewHash !== input.previewHash) throw new JobImportError("IMPORT_PREVIEW_STALE");
        if (selectedDuplicateLines(current.rows, input.selectedRows).length && !input.allowDuplicates) throw new JobImportError("IMPORT_DUPLICATES");
        const jobIds = selected.map(() => randomUUID());
        await tx.job.createMany({ data: selected.map((row, index) => {
          if (!row || !isJobStatus(row.input.status)) throw new JobImportError("IMPORT_INVALID");
          return { ...toJobWriteData({ ...row.input, status: row.input.status }), id: jobIds[index], userId };
        }) });
        const saved = await tx.jobImportBatch.create({ data: { userId, requestId: input.requestId, requestHash, jobIds, rowNumbers: input.selectedRows } });
        return { batchId: saved.id, importedCount: jobIds.length, jobIds, rowNumbers: input.selectedRows, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 15000 }));
    },
  };
}

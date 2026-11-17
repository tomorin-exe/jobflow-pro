import { parse } from "csv-parse/browser/esm/sync";
import { JobImportError } from "@/lib/job-import-error";
import { isJobStatus, normalizeJobInput, validateJobInput } from "@/lib/jobs";
import type { JobInput } from "@/types/job";
import type { CsvRow, ImportPreviewRow } from "@/types/job-import";

export const CSV_MAX_BYTES = 256 * 1024;
export const CSV_MAX_ROWS = 500;
export const CSV_HEADER = "公司,职位,地点,状态,投递日期,备注";
const fields = new Map<string, keyof JobInput>([
  ...["company", "公司", "公司名称"].map((key) => [key, "company"] as const),
  ...["position", "职位", "职位名称", "岗位名称"].map((key) => [key, "position"] as const),
  ...["location", "地点", "工作地点", "城市"].map((key) => [key, "location"] as const),
  ...["status", "状态", "投递状态"].map((key) => [key, "status"] as const),
  ...["appliedat", "applied_at", "投递日期"].map((key) => [key, "appliedAt"] as const),
  ...["notes", "备注"].map((key) => [key, "notes"] as const),
]);
const statuses = new Map<string, JobInput["status"]>([["已投递", "applied"], ["面试中", "interviewing"], ["已录用", "offered"], ["未通过", "rejected"]]);
interface ParsedRecord { record: string[]; info: { bytes: number } }

export function parseJobCsv(csv: string): CsvRow[] {
  if (typeof csv !== "string") throw new JobImportError("CSV_INVALID");
  const sourceBytes = new TextEncoder().encode(csv);
  if (sourceBytes.byteLength > CSV_MAX_BYTES) throw new JobImportError("CSV_LIMIT");
  // CSV 是文本格式，拒绝二进制控制字符；保留字段中的 Tab、CR 和 LF。
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(csv)) throw new JobImportError("CSV_INVALID");
  let records: ParsedRecord[];
  try {
    // info:true 的运行时结果含 record/info；库的无 columns 重载未描述此分支。
    records = parse(csv, { bom: true, info: true, skip_empty_lines: true, relax_column_count: true, record_delimiter: ["\r\n", "\n", "\r"], max_record_size: 8192, to: CSV_MAX_ROWS + 2 }) as unknown as ParsedRecord[];
  } catch (error) {
    const offset = typeof error === "object" && error !== null && "bytes" in error && typeof error.bytes === "number" ? error.bytes : undefined;
    const line = offset === undefined ? undefined : 1 + (new TextDecoder().decode(sourceBytes.subarray(0, offset)).match(/\r\n|\r|\n/g)?.length ?? 0);
    const tooLarge = typeof error === "object" && error !== null && "code" in error && error.code === "CSV_MAX_RECORD_SIZE";
    throw new JobImportError(tooLarge ? "CSV_LIMIT" : "CSV_INVALID", line);
  }
  if (!records.length) throw new JobImportError("CSV_HEADERS");
  if (records.length > CSV_MAX_ROWS + 1) throw new JobImportError("CSV_LIMIT");
  const header = records[0];
  const columns = header.record.map((value) => fields.get(value.normalize("NFKC").trim().toLowerCase()));
  if (columns.some((value) => !value) || new Set(columns).size !== columns.length
    || !["company", "position", "location", "status", "appliedAt"].every((field) => columns.includes(field as keyof JobInput))) {
    throw new JobImportError("CSV_HEADERS");
  }
  // 使用解析器给出的记录字节边界计算物理行号。info.lines 在引号内 CRLF
  // 可能将 CR/LF 分开计数；这里将 CRLF 视为一个换行，也能保留原始备注文本。
  let previousBytes = 0;
  let nextLine = 1;
  const starts = records.map(({ info }) => {
    const span = new TextDecoder().decode(sourceBytes.subarray(previousBytes, info.bytes));
    const leading = span.match(/^(?:(?:\r\n)|\r|\n)*/)?.[0] ?? "";
    const line = nextLine + (leading.match(/\r\n|\r|\n/g)?.length ?? 0);
    nextLine += span.match(/\r\n|\r|\n/g)?.length ?? 0;
    previousBytes = info.bytes;
    return line;
  });
  return records.slice(1).map(({ record }, index) => {
    const line = starts[index + 1];
    // 状态的运行时非法值由同一业务校验器拒绝，不在解析阶段默默补默认值。
    const values: Record<keyof JobInput, string> = { company: "", position: "", location: "", status: "", appliedAt: "", notes: "" };
    columns.forEach((field, index) => { if (field) values[field] = record[index] ?? ""; });
    const status = values.status.trim();
    const input = { ...values, status: isJobStatus(status) ? status : statuses.get(status) ?? status };
    input.appliedAt = input.appliedAt.trim();
    const errors = Object.values(validateJobInput(input));
    if (record.length !== columns.length) errors.unshift("列数与表头不一致");
    return { line, input: normalizeJobInput(input), errors };
  });
}

/** 疑似重复仅作提示；不修改实际存储值，不作数据库唯一约束。 */
export function jobDuplicateKey(input: Pick<JobInput, "company" | "position" | "location">): string {
  return JSON.stringify([input.company, input.position, input.location].map((value) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US")));
}

export function detectJobDuplicates(rows: CsvRow[], existing: readonly Pick<JobInput, "company" | "position" | "location">[]): ImportPreviewRow[] {
  const csvGroups = new Map<string, number[]>();
  const counts = new Map<string, number>();
  for (const row of rows) if (!row.errors.length) {
    const key = jobDuplicateKey(row.input);
    csvGroups.set(key, [...(csvGroups.get(key) ?? []), row.line]);
  }
  for (const job of existing) {
    const key = jobDuplicateKey(job);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.map((row) => ({ ...row,
    csvDuplicateLines: row.errors.length ? [] : (csvGroups.get(jobDuplicateKey(row.input)) ?? []).filter((line) => line !== row.line),
    existingCount: row.errors.length ? 0 : counts.get(jobDuplicateKey(row.input)) ?? 0,
  }));
}

/** 用户只选 CSV 重复组中的一行时，不将未选行算作实际导入重复。 */
export function selectedDuplicateLines(rows: ImportPreviewRow[], selected: readonly number[]): number[] {
  const lines = new Set(selected);
  return rows.filter((row) => lines.has(row.line) && !row.errors.length && (row.existingCount > 0 || row.csvDuplicateLines.some((line) => lines.has(line)))).map((row) => row.line);
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { CSV_HEADER, CSV_MAX_BYTES, detectJobDuplicates, jobDuplicateKey, parseJobCsv, selectedDuplicateLines } from "@/lib/job-csv";
import { JobImportError } from "@/lib/job-import-error";
import { createJobImportClient, ImportClientError, pendingImportIdentity, importRequestKey } from "@/lib/job-import-client";

const record = "公司,开发,上海,已投递,2024-02-29,备注";
const csv = `${CSV_HEADER}\n${record}`;
const hasCode = (code: string) => (error: unknown) => error instanceof JobImportError && error.code === code;

test("可靠解析 UTF-8 BOM、引号内逗号/换行/双引号与 CRLF，行号为实际起始行", () => {
  const rows = parseJobCsv(`\uFEFF${CSV_HEADER}\r\n\r\n"Acme, Inc",开发,上海,interviewing,2024-02-29,"第一行\r\n第二行的""引号"""\r\n${record}\r\n`);
  assert.equal(rows[0].input.company, "Acme, Inc");
  assert.equal(rows[0].input.notes, '第一行\r\n第二行的"引号"');
  assert.equal(rows[0].input.status, "interviewing");
  assert.deepEqual(rows.map((row) => row.line), [3, 5]);
  assert.ok(rows.every((row) => !row.errors.length));
});
test("英文/中文表头、重排字段、可选备注和四种状态复用相同模型", () => {
  const rows = parseJobCsv("status,position,company,applied_at,location\noffered,开发,A,2026-11-17,北京\n未通过,开发,B,2026-11-17,上海");
  assert.equal(rows[0].input.status, "offered"); assert.equal(rows[1].input.status, "rejected");
  assert.equal(rows[0].input.notes, ""); assert.ok(rows.every((row) => !row.errors.length));
});
test("逐行显示必填、日期、状态、字段长度和列数错误，无效行不参与重复检测", () => {
  const rows = parseJobCsv(`${CSV_HEADER}\n,开发,上海,applied,2026-02-30,\n公司,开发,上海,invalid,2026-11-17,\n${"a".repeat(101)},开发,上海,applied,2026-11-17,\n公司,开发,上海,applied,2026-11-17\n公司,开发,上海,applied,2026-11-17,${"x".repeat(2001)}`);
  assert.match(rows[0].errors.join(" "), /公司名称.*日期/);
  assert.match(rows[1].errors.join(" "), /投递状态/);
  assert.match(rows[2].errors.join(" "), /100/);
  assert.match(rows[3].errors.join(" "), /列数/);
  assert.match(rows[4].errors.join(" "), /2000/);
  assert.ok(detectJobDuplicates(rows, [rows[0].input]).every((row) => !row.existingCount && !row.csvDuplicateLines.length));
});
test("异常引号、二进制、非法/重复/保护字段表头均安全拒绝", () => {
  for (const source of ["", "company,company,position,location,status,appliedAt", `${CSV_HEADER},userId\n${record},spoof`]) assert.throws(() => parseJobCsv(source), hasCode("CSV_HEADERS"));
  for (const source of [`${CSV_HEADER}\n"未闭合`, `${csv}\u0000`]) assert.throws(() => parseJobCsv(source), hasCode("CSV_INVALID"));
});
test("限制字节数、500 行和单记录大小，表头文件返回空数据", () => {
  assert.throws(() => parseJobCsv("汉".repeat(Math.ceil(CSV_MAX_BYTES / 3) + 1)), hasCode("CSV_LIMIT"));
  assert.equal(parseJobCsv(`${CSV_HEADER}\n${Array(500).fill(record).join("\n")}`).length, 500);
  assert.throws(() => parseJobCsv(`${CSV_HEADER}\n${Array(501).fill(record).join("\n")}`), hasCode("CSV_LIMIT"));
  assert.throws(() => parseJobCsv(`${CSV_HEADER}\n公司,开发,上海,applied,2026-11-17,${"x".repeat(9000)}`), hasCode("CSV_LIMIT"));
  assert.deepEqual(parseJobCsv(CSV_HEADER), []);
});
test("规范化只用于疑似重复比较，保留原值；日期/状态/备注不影响判定", () => {
  const rows = parseJobCsv(`${CSV_HEADER}\nＡＣＭＥ  科技,前端  开发, 上海 ,applied,2026-11-17,一次\nacme 科技,前端 开发,上海,offered,2026-11-18,二次`);
  assert.equal(jobDuplicateKey(rows[0].input), jobDuplicateKey(rows[1].input));
  assert.equal(rows[0].input.company, "ＡＣＭＥ  科技");
  const preview = detectJobDuplicates(rows, [rows[0].input]);
  assert.deepEqual(preview.map((row) => row.csvDuplicateLines), [[3], [2]]);
  assert.deepEqual(preview.map((row) => row.existingCount), [1, 1]);
});
test("实际选中一条 CSV 重复行时无需重复确认，数据库重复仍需确认", () => {
  const rows = parseJobCsv(`${csv}\n${record}`);
  const preview = detectJobDuplicates(rows, []);
  assert.deepEqual(selectedDuplicateLines(preview, [2]), []);
  assert.deepEqual(selectedDuplicateLines(preview, [2, 3]), [2, 3]);
  assert.deepEqual(selectedDuplicateLines(detectJobDuplicates(rows, [rows[0].input]), [2]), [2]);
});
test("导入客户端只访问同源受保护端点、正常 Cookie、白名单且不回显敏感错误", async () => {
  const calls: RequestInit[] = [];
  const client = createJobImportClient(async (path, init) => {
    assert.ok(String(path).startsWith("/api/me/jobs/import")); calls.push(init!);
    return Response.json({ error: { code: "IMPORT_PREVIEW_STALE", message: "FAKE_SECRET DATABASE_URL" } }, { status: 409 });
  });
  await assert.rejects(() => client.import({ csv, selectedRows: [2], allowDuplicates: false, previewHash: "a".repeat(64), requestId: crypto.randomUUID(), userId: "spoof" } as Parameters<typeof client.import>[0]), (error: unknown) => error instanceof ImportClientError && !error.message.includes("FAKE_SECRET") && error.code === "IMPORT_PREVIEW_STALE");
  assert.equal(calls[0].credentials, "same-origin"); assert.equal(calls[0].cache, "no-store");
  assert.ok(!new Headers(calls[0].headers).has("origin"));
  assert.ok(!String(calls[0].body).includes("userId"));
});
test("网络/超时/非法成功响应视为结果不确定，5xx 可安全复用原批次", async () => {
  const request = { csv, selectedRows: [2], allowDuplicates: false, previewHash: "a".repeat(64), requestId: crypto.randomUUID() };
  for (const fetcher of [async () => { throw new Error("private"); }, async () => Response.json({ error: { code: "UNKNOWN" } }, { status: 503 }), async () => Response.json({ unexpected: true })]) {
    await assert.rejects(() => createJobImportClient(fetcher).import(request), (error: unknown) => error instanceof ImportClientError && error.uncertain && !error.message.includes("private"));
  }
});
test("会话存储只保留批次 ID/确认标志；相同文件和选中行恢复原批次，不同用户隔离", async () => {
  const input = { csv, selectedRows: [3, 2], allowDuplicates: false };
  const key = await importRequestKey("a", input);
  assert.equal(key, await importRequestKey("a", { ...input, selectedRows: [2, 3] }));
  assert.notEqual(key, await importRequestKey("b", input));
  assert.equal(key, await importRequestKey("a", { ...input, allowDuplicates: true }));
  assert.notEqual(key, await importRequestKey("a", { ...input, selectedRows: [2] }));
  const data = new Map<string, string>();
  const storage = { getItem: (name: string) => data.get(name) ?? null, setItem: (name: string, value: string) => { data.set(name, value); } };
  const identity = pendingImportIdentity(key, false, storage);
  assert.deepEqual(pendingImportIdentity(key, true, storage), identity, "刷新后重选疑似重复行，仍恢复原请求的确认标志");
  assert.ok(!JSON.stringify([...data]).includes("公司"));
  assert.doesNotThrow(() => pendingImportIdentity(key, false, { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } }));
});

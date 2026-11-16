import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

// 对实际运行的 Next.js 服务发请求，而不是直接调用 GET 函数。
const baseUrl = process.env.API_BASE_URL || "http://127.0.0.1:3000";
const statuses = ["applied", "interviewing", "offered", "rejected"];

async function request(path, options = {}) {
  const url = new URL(path, baseUrl);
  try {
    return await fetch(url, { signal: AbortSignal.timeout(5000), ...options });
  } catch (cause) {
    throw new Error(`无法请求 ${url}，请先启动 Next.js 服务，并检查 API_BASE_URL。`, { cause });
  }
}

async function getJson(path, expectedStatus = 200) {
  const response = await request(path);
  assert.equal(response.status, expectedStatus, `${path} 的 HTTP 状态码不正确`);
  assert.match(response.headers.get("content-type") || "", /^application\/json\b/i);
  return response.json();
}

test("GET /api/health 返回规定的 JSON", async () => {
  assert.deepEqual(await getJson("/api/health"), { status: "ok", service: "jobflow" });
});

describe("GET /api/jobs", () => {
  let baseline;

  before(async () => {
    baseline = await getJson("/api/jobs");
  });

  test("返回完整的模拟数据、Job 字段和正确的 total", () => {
    assert.deepEqual(Object.keys(baseline).sort(), ["data", "total"]);
    assert.ok(Array.isArray(baseline.data));
    assert.equal(baseline.total, 8);
    assert.equal(baseline.total, baseline.data.length);
    assert.equal(new Set(baseline.data.map((job) => job.id)).size, baseline.total);

    for (const job of baseline.data) {
      for (const field of ["id", "company", "position", "location", "status", "appliedAt", "notes"]) {
        assert.equal(typeof job[field], "string", `${job.id} 的 ${field} 应为字符串`);
      }
      assert.ok(job.id && job.company && job.position && job.location);
      assert.ok(statuses.includes(job.status));
      assert.match(job.appliedAt, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  for (const status of statuses) {
    test(`status=${status} 只返回匹配岗位，total 等于筛选数量`, async () => {
      const expected = baseline.data.filter((job) => job.status === status);
      assert.ok(expected.length > 0, `当前模拟数据应覆盖 ${status} 状态`);
      assert.deepEqual(await getJson(`/api/jobs?status=${status}`), {
        data: expected,
        total: expected.length,
      });
    });
  }

  const invalidQueries = [
    ["未知状态", "status=unknown"],
    ["前端专用的 all", "status=all"],
    ["空值", "status="],
    ["无等号的空值", "status"],
    ["大小写错误", "status=APPLIED"],
    ["中文显示文案", `status=${encodeURIComponent("已投递")}`],
    ["前后空格", "status=%20applied%20"],
    ["重复不同值", "status=applied&status=offered"],
    ["重复相同值", "status=applied&status=applied"],
  ];

  for (const [label, query] of invalidQueries) {
    test(`${label}返回 400 和明确的 JSON 错误`, async () => {
      const body = await getJson(`/api/jobs?${query}`, 400);
      assert.deepEqual(Object.keys(body), ["error"]);
      assert.equal(body.error.code, "INVALID_STATUS");
      assert.equal(typeof body.error.message, "string");
      assert.ok(body.error.message.includes("status"));
      for (const status of statuses) assert.ok(body.error.message.includes(status));
    });
  }

  test("筛选及非法请求不会改变原始数据或记录 ID", async () => {
    assert.deepEqual(await getJson("/api/jobs"), baseline);
  });
});

describe("只读接口", () => {
  for (const path of ["/api/health", "/api/jobs"]) {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      test(`${method} ${path} 返回 405`, async () => {
        const response = await request(path, { method });
        assert.equal(response.status, 405);
      });
    }
  }
});

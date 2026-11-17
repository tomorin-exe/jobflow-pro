import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import nextEnv from "@next/env";
import { withDatabaseErrors } from "@/lib/database-error";
import { disconnectPrisma, getPrisma } from "@/lib/prisma";

// 只在本地应用数据库创建一个唯一测试账号，finally 按精确邮箱/UUID 清理。
// 不输出响应体、Cookie、密码、连接串，不修改任何环境变量文件。
nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => { throw new Error("无法加载本地测试配置。"); } });
const baseURL = new URL(process.env.API_BASE_URL ?? "http://localhost:3000");
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseURL.hostname)) throw new Error("认证集成测试只允许访问本地测试服务器。");

before(async () => {
  const [context] = await withDatabaseErrors(() => getPrisma().$queryRaw<{ database: string; role: string }[]>`
    SELECT current_database() AS database, current_user AS role
  `);
  assert.ok(context?.database === "jobflow_db" && context.role === "jobflow_app", "仅允许使用指定的应用数据库账号测试");
});
after(async () => { await disconnectPrisma(); });

async function request(path: string, options: RequestInit = {}) {
  try {
    return await fetch(new URL(path, baseURL), { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10000), ...options });
  } catch { throw new Error("无法访问本地认证测试服务，请先启动服务器并检查 API_BASE_URL。"); }
}
async function json(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new Error("认证接口未返回预期的 JSON。"); }
}
function cookieFrom(response: Response): string {
  return response.headers.getSetCookie().map((line) => line.split(";", 1)[0]).filter(Boolean).join("; ");
}
async function post(path: string, body: unknown, cookie = "") {
  return request(path, { method: "POST", headers: { "content-type": "application/json", origin: baseURL.origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}
function assertSignInRedirect(response: Response) {
  assert.equal(response.status, 307, "未认证访问必须由服务端重定向");
  assert.equal(new URL(response.headers.get("location") ?? "", baseURL).pathname, "/sign-in");
}

test("匿名用户无法访问工作空间；伪造 Cookie 无效；认证页面和演示可公开访问", async () => {
  assertSignInRedirect(await request("/dashboard"));
  assertSignInRedirect(await request("/dashboard", { headers: { cookie: "better-auth.session_token=forged-test-cookie" } }));
  for (const path of ["/sign-in", "/sign-up", "/demo"]) assert.equal((await request(path)).status, 200);
  const demo = await (await request("/demo")).text();
  assert.ok(demo.includes("不属于任何登录账号"), "演示必须明确说明数据归属");
});

test("真实注册、登录、错误凭据及退出后的旧 Session 撤销；测试账号最终清理", { timeout: 60000 }, async () => {
  const email = `jobflow-auth-test-${randomUUID()}@example.invalid`;
  const password = `${randomUUID()}-${randomUUID()}`;
  const name = "认证端到端测试";
  const exists = await withDatabaseErrors(() => getPrisma().user.count({ where: { email } }));
  assert.equal(exists, 0, "测试邮箱必须此前不存在");

  function assertSafe(value: unknown) {
    const body = JSON.stringify(value);
    assert.ok(!body.includes(password), "响应不应包含测试密码");
    assert.ok(!/DATABASE_URL|BETTER_AUTH_SECRET|postgresql:\/\/|PrismaClient|\bstack\b/i.test(body), "响应不应包含服务端内部细节");
  }
  async function session(cookie: string): Promise<unknown> {
    const response = await request("/api/auth/get-session", { headers: { cookie } });
    assert.equal(response.status, 200, "获取 Session 应成功");
    return json(response);
  }
  try {
    const registration = await post("/api/auth/sign-up/email", { name, email, password });
    assert.equal(registration.status, 200, "注册应成功，请确认本地认证配置和测试服务器来源一致");
    assertSafe(await json(registration));
    const registeredCookie = cookieFrom(registration);
    assert.ok(Boolean(registeredCookie), "当前自动登录配置应设置 Cookie");
    assert.ok(registration.headers.getSetCookie().some((line) => /;\s*HttpOnly/i.test(line)), "会话 Cookie 应为 HttpOnly");
    assert.ok(Boolean(await session(registeredCookie)), "注册后应获得真实会话");
    const dashboard = await request("/dashboard", { headers: { cookie: registeredCookie } });
    assert.equal(dashboard.status, 200);
    const html = await dashboard.text();
    assert.ok(html.includes(name) && html.includes(email) && html.includes("岗位数据库接入中"));
    assert.ok(!html.includes("正在读取本地岗位记录"), "受保护页面不得混入本地演示岗位");

    const signOut = await post("/api/auth/sign-out", {}, registeredCookie);
    assert.equal(signOut.status, 200);
    assert.equal(await session(registeredCookie), null, "重放旧 Cookie 也不能恢复已撤销 Session");
    assertSignInRedirect(await request("/dashboard", { headers: { cookie: registeredCookie } }));

    const wrong = await post("/api/auth/sign-in/email", { email, password: `${randomUUID()}-wrong` });
    const missing = await post("/api/auth/sign-in/email", { email: `missing-${randomUUID()}@example.invalid`, password });
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    const wrongBody = await json(wrong);
    const missingBody = await json(missing);
    assertSafe(wrongBody);
    assertSafe(missingBody);
    assert.ok(typeof wrongBody === "object" && wrongBody !== null && "code" in wrongBody);
    assert.ok(typeof missingBody === "object" && missingBody !== null && "code" in missingBody);
    assert.equal(wrongBody.code, missingBody.code, "错误密码和不存在账号不应暴露不同凭据结果");

    const login = await post("/api/auth/sign-in/email", { email, password });
    assert.equal(login.status, 200, "邮箱密码登录应成功");
    assertSafe(await json(login));
    const signedInCookie = cookieFrom(login);
    assert.ok(Boolean(await session(signedInCookie)));
    assert.equal((await request("/sign-in", { headers: { cookie: signedInCookie } })).status, 307, "已登录访问认证页面应跳转");
    assert.equal((await post("/api/auth/sign-out", {}, signedInCookie)).status, 200);
    assert.equal(await session(signedInCookie), null);
  } finally {
    // 仅清理本次随机邮箱对应的测试账号，不查询/删除其他用户的数据。
    const user = await withDatabaseErrors(() => getPrisma().user.findUnique({ where: { email }, select: { id: true } }));
    if (user) {
      assert.equal(await withDatabaseErrors(() => getPrisma().job.count({ where: { userId: user.id } })), 0, "测试账号不应有岗位，禁止连带清理业务记录");
      await withDatabaseErrors(() => getPrisma().user.delete({ where: { id: user.id, email } }));
      assert.equal(await withDatabaseErrors(() => getPrisma().session.count({ where: { userId: user.id } })), 0);
      assert.equal(await withDatabaseErrors(() => getPrisma().account.count({ where: { userId: user.id } })), 0);
    }
    assert.equal(await withDatabaseErrors(() => getPrisma().user.count({ where: { email } })), 0, "测试账号必须完成清理");
  }
});

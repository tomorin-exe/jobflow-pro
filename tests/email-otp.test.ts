import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { after, before, describe, test } from "node:test";
import type { AddressInfo } from "node:net";
import nextEnv from "@next/env";
import nodemailer from "nodemailer";
import { SMTPServer } from "smtp-server";
import { toNodeHandler } from "better-auth/node";
import { createAuth } from "@/lib/auth";
import { createOtpMailer } from "@/lib/mail";
import { createOtpRateLimiter, OtpRateLimitError } from "@/lib/otp-rate-limit";
import { getPrisma, disconnectPrisma } from "@/lib/prisma";
import { withDatabaseErrors } from "@/lib/database-error";
import { assertTestDatabase } from "./helpers/test-database";

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => { throw Error("配置无法加载"); } });
const secret = `${randomUUID()}-${randomUUID()}`;
const namespace = `otp-test-${randomUUID()}:`;
const emails = new Set<string>();
const cleanupAllowed = new Set<string>();
const identifiers = new Set<string>();
const passwords: string[] = [];
const inbox: { email: string; otp: string }[] = [];
let rejectMail = false;
let time = Date.now();
let databaseVerified = false;
let auth: ReturnType<typeof createAuth>;
let baseURL: string;
let transport: ReturnType<typeof nodemailer.createTransport>;
const smtp = new SMTPServer({ secure: false, authOptional: true, disabledCommands: ["STARTTLS"], logger: false,
  onData(stream, session, done) {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.once("error", () => done(new Error("Mock SMTP failed")));
    stream.once("end", () => {
      if (rejectMail) { done(Object.assign(new Error("TEST_ONLY_PRIVATE_SMTP_DETAIL"), { responseCode: 550 })); return; }
      const message = Buffer.concat(chunks).toString("utf8");
      const separator = message.search(/\r?\n\r?\n/);
      const headers = message.slice(0, separator);
      let body = message.slice(separator).replace(/^\r?\n\r?\n/, "");
      if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
      if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)) body = body.replace(/=\r?\n/g, "").replace(/=([0-9a-f]{2})/gi, (_, value: string) => String.fromCharCode(parseInt(value, 16)));
      const otp = body.match(/\b\d{6}\b/)?.[0];
      if (!otp || session.envelope.rcptTo.length !== 1) { done(new Error("Mock mail format error")); return; }
      inbox.push({ email: session.envelope.rcptTo[0].address, otp }); done();
    });
  },
});
const server = createServer((req, res) => { void toNodeHandler(auth)(req, res); });
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const address = () => { const email = `otp-${randomUUID()}@example.invalid`; emails.add(email); return email; };
async function post(path: string, body: unknown, cookie?: string, origin: string | null = baseURL) {
  if (object(body) && typeof body.email === "string") {
    const email = body.email.toLowerCase();
    if (emails.has(email) && !cleanupAllowed.has(email)) {
      assert.equal(await withDatabaseErrors(() => getPrisma().user.count({ where: { email } })), 0, "测试邮箱必须此前不存在");
      cleanupAllowed.add(email);
    }
  }
  const response = await fetch(`${baseURL}/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data: unknown = await response.json();
  const text = JSON.stringify(data);
  assert.ok(!/DATABASE_URL|postgresql:\/\/|PRIVATE_SMTP|test-only-smtp-code|\bstack\b|PrismaClient/.test(text));
  for (const password of passwords) assert.ok(!text.includes(password), "不得回显密码");
  return { response, data };
}
function cookie(response: Response) { return response.headers.getSetCookie().map((part) => part.split(";", 1)[0]).join("; "); }
function code(value: unknown) { assert.ok(object(value)); return value.code; }
async function session(value: string) { return (await fetch(`${baseURL}/api/auth/get-session`, { headers: { cookie: value } })).json() as Promise<unknown>; }
async function verification(email: string, type = "sign-in") {
  const row = await (await auth.$context).internalAdapter.findVerificationValue(`${type}-otp-${email}`);
  if (row) identifiers.add(row.identifier);
  return row;
}
async function send(email: string, type = "sign-in", sessionCookie?: string, expected = 200) {
  const result = await post("/email-otp/send-verification-otp", { email, type }, sessionCookie);
  await verification(email, type);
  assert.equal(result.response.status, expected, "发送验证码 HTTP 状态异常");
  const mail = [...inbox].reverse().find((entry) => entry.email === email);
  if (expected === 200) assert.ok(mail, "本地模拟 SMTP 必须收到邮件");
  return mail?.otp ?? "";
}

describe("Email OTP + Nodemailer 本地模拟 SMTP", { concurrency: false }, () => {
  before(async () => {
    await assertTestDatabase();
    databaseVerified = true;
    await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
    transport = nodemailer.createTransport({ host: "127.0.0.1", port: (smtp.server.address() as AddressInfo).port, secure: false, ignoreTLS: true, logger: false, debug: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    auth = createAuth(getPrisma(), { secret, baseURL }, { sendMail: createOtpMailer({ user: "fixture@qq.com", pass: "test-only-smtp-code" }, transport), limiter: createOtpRateLimiter(getPrisma(), secret, { namespace, now: () => time }) });
  });
  after(async () => {
    try {
      if (!databaseVerified) return;
      for (const email of cleanupAllowed) {
        for (const type of ["sign-in", "email-verification"]) await verification(email, type);
        await withDatabaseErrors(() => getPrisma().$transaction(async (tx) => {
          const user = await tx.user.findUnique({ where: { email }, select: { id: true } });
          if (user) {
            assert.equal(await tx.job.count({ where: { userId: user.id } }), 0, "不得删除带业务岗位的用户");
            await tx.user.delete({ where: { id: user.id, email } });
          }
        }));
      }
      const ownRows = await withDatabaseErrors(() => getPrisma().verification.findMany({ where: { OR: [{ identifier: { in: [...identifiers] } }, { identifier: { startsWith: namespace } }] }, select: { id: true, identifier: true } }));
      for (const row of ownRows) await withDatabaseErrors(() => getPrisma().verification.delete({ where: { id: row.id, identifier: row.identifier } }));
      assert.equal(await withDatabaseErrors(() => getPrisma().user.count({ where: { email: { in: [...cleanupAllowed] } } })), 0);
    } finally {
      transport?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => smtp.close(() => resolve()));
      await disconnectPrisma();
    }
  });
  test("官方插件配置为6位、300秒、3次尝试、加密存储，不自动给密码注册发信", async () => {
    const plugin = auth.options.plugins?.find((plugin) => plugin.id === "email-otp");
    assert.ok(plugin && "options" in plugin);
    assert.deepEqual([plugin.options.otpLength, plugin.options.expiresIn, plugin.options.allowedAttempts, plugin.options.storeOTP, plugin.options.sendVerificationOnSignUp], [6, 300, 3, "encrypted", false]);
  });
  test("真实本地 SMTP 收到6位验证码，数据库无明文验证码/邮箱标识，有效期5分钟", async () => {
    const email = address(); const otp = await send(email);
    const row = await verification(email); assert.ok(row);
    assert.match(otp, /^\d{6}$/); assert.notEqual(row.value.split(":")[0], otp); assert.ok(!row.identifier.includes(email));
    assert.ok(row.expiresAt.getTime() > Date.now() + 290000 && row.expiresAt.getTime() < Date.now() + 301000);
  });
  test("新邮箱通过验证码创建已验证用户和Cookie Session，重放验证码无效", async () => {
    const email = address(); const otp = await send(email);
    const result = await post("/sign-in/email-otp", { email, otp, name: "OTP 新用户" });
    assert.equal(result.response.status, 200); const value = cookie(result.response); assert.ok(value);
    const current = await session(value); assert.ok(object(current) && object(current.user) && current.user.emailVerified === true);
    assert.equal(current.user.name, "OTP 新用户");
    assert.equal((await post("/sign-in/email-otp", { email, otp })).response.status, 400);
  });
  test("三次错误后正确验证码也不能登录", async () => {
    const email = address(); const otp = await send(email); const wrong = otp === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) assert.equal((await post("/sign-in/email-otp", { email, otp: wrong })).response.status, 400);
    const result = await post("/sign-in/email-otp", { email, otp });
    assert.equal(result.response.status, 403); assert.equal(code(result.data), "TOO_MANY_ATTEMPTS");
    assert.equal(await withDatabaseErrors(() => getPrisma().user.count({ where: { email } })), 0);
  });
  test("过期验证码被拒绝，不创建账号", async () => {
    const email = address(); const otp = await send(email); const row = await verification(email); assert.ok(row);
    await withDatabaseErrors(() => getPrisma().verification.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    assert.equal((await post("/sign-in/email-otp", { email, otp })).response.status, 400);
  });
  test("60秒冷却在服务端生效，返回 Retry-After，伪造IP头无法绕过", async () => {
    const email = address(); await send(email); const before = inbox.length;
    const response = await fetch(`${baseURL}/api/auth/email-otp/send-verification-otp`, { method: "POST", headers: { origin: baseURL, "content-type": "application/json", "x-forwarded-for": "192.0.2.99" }, body: JSON.stringify({ email: email.toUpperCase(), type: "sign-in" }) });
    assert.equal(response.status, 429); assert.ok(Number(response.headers.get("retry-after")) > 0); assert.equal(inbox.length, before);
  });
  test("重发后旧码失效，新码可用（使用最新一封邮件）", async () => {
    const email = address(); const old = await send(email); time += 61000; const latest = await send(email);
    if (old !== latest) assert.equal((await post("/sign-in/email-otp", { email, otp: old })).response.status, 400);
    assert.equal((await post("/sign-in/email-otp", { email, otp: latest })).response.status, 200);
  });
  test("同一码并发只有一次成功，注销后原Cookie失效", async () => {
    const email = address(); const otp = await send(email);
    const results = await Promise.all([post("/sign-in/email-otp", { email, otp }), post("/sign-in/email-otp", { email, otp })]);
    assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 400]);
    const value = cookie(results.find((result) => result.response.status === 200)!.response);
    assert.equal((await post("/sign-out", {}, value)).response.status, 200); assert.equal(await session(value), null);
  });
  test("无Origin/跨站、非法邮箱/代码、未开放密码重置用途被拒绝", async () => {
    const email = address();
    for (const origin of [null, "https://evil.example"]) assert.equal((await post("/email-otp/send-verification-otp", { email, type: "sign-in" }, undefined, origin)).response.status, 403);
    assert.equal((await post("/email-otp/send-verification-otp", { email: "bad", type: "sign-in" })).response.status, 400);
    assert.equal((await post("/sign-in/email-otp", { email, otp: "abc123" })).response.status, 400);
    assert.equal((await post("/email-otp/send-verification-otp", { email, type: "forget-password" })).response.status, 400);
    assert.equal((await post("/email-otp/request-password-reset", { email })).response.status, 404);
  });
  test("SMTP拒收只返回安全错误，不创建用户或泄露授权码/底层响应", async () => {
    const email = address(); time += 61000; rejectMail = true;
    try { await send(email, "sign-in", undefined, 503); } finally { rejectMail = false; }
    assert.equal(await withDatabaseErrors(() => getPrisma().user.count({ where: { email } })), 0);
  });
  test("未验证密码账号不会被OTP静默删除密码/会话；完成带会话邮箱验证后保留密码", async () => {
    const email = address(); const password = `${randomUUID()}-password`; passwords.push(password);
    const registered = await post("/sign-up/email", { email, password, name: "旧密码用户" }); assert.equal(registered.response.status, 200);
    const firstCookie = cookie(registered.response);
    const second = await post("/sign-in/email", { email, password }); assert.equal(second.response.status, 200); const secondCookie = cookie(second.response);
    const user = await withDatabaseErrors(() => getPrisma().user.findUnique({ where: { email }, include: { accounts: true } })); assert.ok(user);
    const storedPassword = user.accounts.find((account) => account.providerId === "credential")!.password;
    time += 61000; const otp = await send(email);
    const blocked = await post("/sign-in/email-otp", { email, otp });
    assert.equal(blocked.response.status, 403); assert.equal(code(blocked.data), "PASSWORD_ACCOUNT_VERIFICATION_REQUIRED");
    assert.ok(await session(firstCookie)); assert.ok(await session(secondCookie));
    assert.equal((await withDatabaseErrors(() => getPrisma().account.findFirst({ where: { userId: user.id, providerId: "credential" } })))?.password, storedPassword);
    assert.equal((await post("/email-otp/verify-email", { email, otp })).response.status, 401);
    time += 61000; const verify = await send(email, "email-verification", secondCookie);
    const confirmed = await post("/email-otp/verify-email", { email, otp: verify }, secondCookie); assert.equal(confirmed.response.status, 200);
    assert.equal(await session(firstCookie), null); assert.ok(await session(secondCookie));
    assert.equal((await withDatabaseErrors(() => getPrisma().account.findFirst({ where: { userId: user.id, providerId: "credential" } })))?.password, storedPassword);
    assert.equal((await post("/sign-in/email", { email, password })).response.status, 200);
    time += 61000; const verifiedOtp = await send(email);
    assert.equal((await post("/sign-in/email-otp", { email, otp: verifiedOtp })).response.status, 200);
  });
  test("过旧会话或他人会话不能升级未验证邮箱", async () => {
    const email = address(); const password = `${randomUUID()}-password`; passwords.push(password);
    const registered = await post("/sign-up/email", { email, password, name: "Fresh test" }); assert.equal(registered.response.status, 200);
    const value = cookie(registered.response); const current = await session(value); assert.ok(object(current) && object(current.session) && typeof current.session.id === "string");
    const sessionId = current.session.id;
    await withDatabaseErrors(() => getPrisma().session.update({ where: { id: sessionId }, data: { createdAt: new Date(Date.now() - 600000) } }));
    const expired = await post("/email-otp/send-verification-otp", { email, type: "email-verification" }, value);
    assert.equal(expired.response.status, 403); assert.equal(code(expired.data), "SESSION_NOT_FRESH");
    assert.equal((await post("/email-otp/verify-email", { email: address(), otp: "123456" }, value)).response.status, 401);
  });
  test("限流跨实例原子生效，按邮箱独立、每小时额度不可通过重发绕过", async () => {
    const localNamespace = `${namespace}atomic:`;
    let timestamp = Date.now();
    const limiter = () => createOtpRateLimiter(getPrisma(), secret, { namespace: localNamespace, now: () => timestamp });
    const email = address();
    const results = await Promise.allSettled([limiter().consume(email, "send"), limiter().consume(email.toUpperCase(), "send")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof OtpRateLimitError).length, 1);
    for (let i = 0; i < 4; i++) { timestamp += 61000; await limiter().consume(email, "send"); }
    timestamp += 61000;
    await assert.rejects(() => limiter().consume(email, "send"), OtpRateLimitError);
    await limiter().consume(address(), "send");
  });
  test("全站发送额度限制不同邮箱的邮件轰炸，不能通过换收件人绕过", async () => {
    let timestamp = Date.now();
    const limiter = createOtpRateLimiter(getPrisma(), secret, { namespace: `${namespace}global:`, now: () => timestamp });
    for (let minute = 0; minute < 6; minute++) {
      for (let i = 0; i < 10; i++) await limiter.consume(address(), "send");
      await assert.rejects(() => limiter.consume(address(), "send"), OtpRateLimitError);
      timestamp += 61000;
    }
    await assert.rejects(() => limiter.consume(address(), "send"), (error: unknown) => error instanceof OtpRateLimitError && error.retryAfter > 60);
  });
  test("每邮箱验证额度跨验证码有效，防止重发刷新猜测预算", async () => {
    const limiter = createOtpRateLimiter(getPrisma(), secret, { namespace: `${namespace}guesses:` });
    const email = address();
    for (let i = 0; i < 10; i++) await limiter.consume(email, "attempt");
    await assert.rejects(() => limiter.consume(email, "attempt"), OtpRateLimitError);
    await limiter.consume(address(), "attempt");
  });
});

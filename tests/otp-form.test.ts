import assert from "node:assert/strict";
import { test } from "node:test";
import { validateOtpForm, otpCountdown, otpErrorMessage } from "@/lib/otp-form";
import { createOtpMailer, readSmtpEnvironment, qqSmtpOptions, MailError } from "@/lib/mail";

test("验证码表单校验姓名、邮箱及6位数字，发送时不要求验证码", () => {
  const values = { name: "Test", email: "test@example.invalid", otp: "012345" };
  assert.deepEqual(validateOtpForm("sign-up", values, true), {});
  assert.deepEqual(validateOtpForm("sign-in", { ...values, name: "", otp: "" }, false), {});
  assert.ok(validateOtpForm("sign-up", { ...values, name: " " }, false).name);
  for (const email of ["", "bad", "a b@example.com", "x".repeat(255)]) assert.ok(validateOtpForm("sign-in", { ...values, email }, false).email);
  for (const otp of ["", "12345", "1234567", "abcdef", "１２３４５６", " 12345"]) assert.ok(validateOtpForm("sign-in", { ...values, otp }, true).otp);
});
test("倒计时不会提前归零、不会出现负数", () => {
  assert.equal(otpCountdown(60001, 0), 61); assert.equal(otpCountdown(60000, 59999), 1); assert.equal(otpCountdown(60000, 61000), 0);
});
test("安全错误映射包括旧密码兼容、限流、过期、尝试超限，不回显敏感信息", () => {
  for (const code of ["INVALID_OTP", "OTP_EXPIRED", "TOO_MANY_ATTEMPTS", "PASSWORD_ACCOUNT_VERIFICATION_REQUIRED", "SESSION_NOT_FRESH", "OTP_RATE_LIMITED", "UNKNOWN"]) {
    assert.ok(otpErrorMessage({ code, message: "PRIVATE_SMTP_CODE" }));
    assert.ok(!otpErrorMessage({ code, message: "PRIVATE_SMTP_CODE" }).includes("PRIVATE_SMTP_CODE"));
  }
  assert.match(otpErrorMessage({ code: "PASSWORD_ACCOUNT_VERIFICATION_REQUIRED" }), /原密码/);
  assert.match(otpErrorMessage({ status: 429 }), /倒计时/);
  assert.match(otpErrorMessage({ status: 503 }), /暂时不可用/);
});
test("QQ SMTP 固定465/TLS、校验证书、禁用日志，缺少或占位配置安全拒绝", () => {
  const options = qqSmtpOptions(readSmtpEnvironment({ QQ_SMTP_USER: "fixture@qq.com", QQ_SMTP_AUTH_CODE: "test-only-smtp-code" }));
  assert.equal(options.host, "smtp.qq.com"); assert.equal(options.port, 465); assert.equal(options.secure, true);
  assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.logger, false); assert.equal(options.debug, false);
  for (const env of [{}, { QQ_SMTP_USER: "bad", QQ_SMTP_AUTH_CODE: "PRIVATE_SECRET" }, { QQ_SMTP_USER: "fixture@qq.com", QQ_SMTP_AUTH_CODE: "REPLACE_WITH_CODE" }]) assert.throws(() => readSmtpEnvironment(env), (error: unknown) => error instanceof MailError && !error.message.includes("PRIVATE_SECRET"));
});
test("邮件模块拒绝收件人注入及非6位代码，SMTP 认证错误不被向上传递", async () => {
  let calls = 0;
  const send = createOtpMailer({ user: "fixture@qq.com", pass: "test-only-smtp-code" }, { sendMail: async () => { calls++; throw new Error("535 PRIVATE_SECRET"); } });
  await assert.rejects(() => send({ email: "test@example.invalid\r\nBcc:evil@example.invalid", otp: "123456", type: "sign-in" }), MailError);
  assert.equal(calls, 0);
  await assert.rejects(() => send({ email: "test@example.invalid", otp: "123456", type: "sign-in" }), (error: unknown) => error instanceof MailError && !error.message.includes("PRIVATE_SECRET"));
});

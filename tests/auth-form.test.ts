import assert from "node:assert/strict";
import { test } from "node:test";
import { authErrorMessage, postAuthDestination, validateAuthForm, type AuthFormValues } from "@/lib/auth-form";

const valid: AuthFormValues = { name: "求职者", email: "applicant@example.invalid", password: "test-password-only", confirmPassword: "test-password-only" };

test("注册缺失必填项时显示对应字段错误", () => {
  const errors = validateAuthForm("sign-up", { name: "  ", email: "", password: "", confirmPassword: "" });
  assert.deepEqual(Object.keys(errors), ["name", "email", "password", "confirmPassword"]);
});

test("注册校验邮箱、密码长度与确认密码，并保留密码空格", () => {
  for (const email of ["invalid", "a@", "@example.com", "a b@example.com", "a@example"]) assert.ok(validateAuthForm("sign-up", { ...valid, email }).email);
  for (const password of ["1234567", "x".repeat(129)]) assert.ok(validateAuthForm("sign-up", { ...valid, password }).password);
  assert.ok(validateAuthForm("sign-up", { ...valid, confirmPassword: "different" }).confirmPassword);
  assert.ok(validateAuthForm("sign-up", { ...valid, name: "x".repeat(101) }).name);
  assert.deepEqual(validateAuthForm("sign-up", { ...valid, name: "  姓名  ", email: " user@example.com ", password: " 123456 ", confirmPassword: " 123456 " }), {});
  assert.ok(validateAuthForm("sign-up", { ...valid, password: " 123456 ", confirmPassword: "123456" }).confirmPassword);
});

test("登录只要求邮箱与密码，不要求姓名及确认密码", () => {
  assert.deepEqual(validateAuthForm("sign-in", { ...valid, name: "", confirmPassword: "" }), {});
  assert.ok(validateAuthForm("sign-in", { ...valid, email: "", password: "" }).password);
  assert.ok(validateAuthForm("sign-in", { ...valid, password: "x".repeat(129) }).password);
});

test("错误密码与不存在账号使用相同提示，未知敏感错误不被回显", () => {
  const wrongPassword = authErrorMessage({ code: "INVALID_PASSWORD" }, "sign-in");
  assert.equal(wrongPassword, authErrorMessage({ code: "USER_NOT_FOUND" }, "sign-in"));
  assert.equal(wrongPassword, authErrorMessage({ code: "INVALID_EMAIL_OR_PASSWORD" }, "sign-in"));
  for (const error of [
    new Error("DATABASE_URL=postgresql://private:FAKE_SECRET@private-host/db"),
    { status: 500, code: "UNKNOWN", message: "password=FAKE_SECRET" },
    { code: "FAKE_SECRET", message: "database details" }, undefined,
  ]) assert.doesNotMatch(authErrorMessage(error, "sign-in"), /FAKE_SECRET|DATABASE_URL|postgresql|private-host|database details/);
  assert.match(authErrorMessage({ status: 429 }, "sign-up"), /频繁/);
});

test("导航根据实际 Session 状态决定，注册无会话时转登录", () => {
  assert.equal(postAuthDestination("sign-up", true), "/dashboard");
  assert.equal(postAuthDestination("sign-in", true), "/dashboard");
  assert.equal(postAuthDestination("sign-up", false), "/sign-in?registered=1");
  assert.equal(postAuthDestination("sign-in", false), null);
});

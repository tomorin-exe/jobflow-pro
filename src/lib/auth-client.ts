"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

// 同源 /api/auth 请求：密码、会话 Cookie 和退出逻辑交给 Better Auth。
// 可调用 authClient.signUp.email / signIn.email / signOut / getSession / useSession。
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });

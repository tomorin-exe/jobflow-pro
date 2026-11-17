import "server-only";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { AuthError, safeAuthError } from "@/lib/auth-error";
import { requireAuthSchema } from "@/lib/auth-schema";

export async function readSession(requestHeaders: Headers) {
  // 没有 Cookie 可以直接确认未登录；存在 Cookie 时仍由 Better Auth 验证并查库。
  if (!requestHeaders.get("cookie")) return null;
  try {
    await requireAuthSchema();
    return await getAuth().api.getSession({ headers: requestHeaders });
  } catch (error) {
    throw safeAuthError(error);
  }
}

export async function getCurrentSession() {
  // headers() 的 Next.js 渲染控制异常必须交回框架，不能包装为认证错误。
  // readSession 内部仍对配置和数据库认证异常脱敏。
  const requestHeaders = await headers();
  return readSession(requestHeaders);
}

export async function requireUserId(): Promise<string> {
  const session = await getCurrentSession();
  if (!session?.user.id) throw new AuthError("UNAUTHORIZED");
  return session.user.id;
}

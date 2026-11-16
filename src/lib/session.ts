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
  try {
    return await readSession(await headers());
  } catch (error) {
    throw safeAuthError(error);
  }
}

export async function requireUserId(): Promise<string> {
  const session = await getCurrentSession();
  if (!session?.user.id) throw new AuthError("UNAUTHORIZED");
  return session.user.id;
}

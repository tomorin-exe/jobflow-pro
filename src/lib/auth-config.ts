import "server-only";
import { AuthError } from "@/lib/auth-error";

export function readAuthEnvironment(env: Readonly<Record<string, string | undefined>> = process.env) {
  const secret = env.BETTER_AUTH_SECRET;
  const address = env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || /REPLACE_WITH|CHANGE_ME/i.test(secret) || !address) {
    throw new AuthError("AUTH_NOT_CONFIGURED");
  }
  let url: URL;
  try { url = new URL(address); } catch { throw new AuthError("AUTH_NOT_CONFIGURED"); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash
    || (url.protocol === "http:" && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new AuthError("AUTH_NOT_CONFIGURED");
  }
  return { secret, baseURL: url.origin };
}

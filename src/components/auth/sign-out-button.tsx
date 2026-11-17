"use client";

import { useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-form";

export function SignOutButton() {
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signOut();
      if (result.error) { setError(authErrorMessage(result.error, "sign-out")); return; }
      const session = await authClient.getSession({ fetchOptions: { cache: "no-store" } });
      if (session.error || session.data?.session) {
        setError("暂时无法确认退出状态，请重试。");
        return;
      }
      window.location.replace("/sign-in");
    } catch {
      setError("退出登录未完成，请检查网络后重试。");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button type="button" onClick={signOut} disabled={pending} aria-busy={pending} className="min-h-10 rounded-lg border border-line bg-white px-4 py-2 text-xs font-medium text-secondary hover:border-brand hover:text-brand">
        {pending ? "正在退出…" : "退出登录"}
      </button>
      {error && <p role="alert" className="max-w-xs text-right text-xs leading-5 text-red-700">{error}</p>}
    </div>
  );
}

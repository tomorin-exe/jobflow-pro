import { NextRequest, NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { safeAuthError } from "@/lib/auth-error";
import { requireAuthSchema } from "@/lib/auth-schema";

export const runtime = "nodejs";

async function handle(request: NextRequest, method: "GET" | "POST") {
  try {
    await requireAuthSchema();
    const response = await toNextJsHandler(getAuth())[method](request);
    // 框架/数据库错误不以原始响应传给客户端。
    if (response.status >= 500) throw new Error("Authentication operation failed");
    return response;
  } catch (error) {
    const safe = safeAuthError(error);
    return NextResponse.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status });
  }
}

export function GET(request: NextRequest) { return handle(request, "GET"); }
export function POST(request: NextRequest) { return handle(request, "POST"); }

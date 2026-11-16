import { NextResponse } from "next/server";
import type { HealthResponse } from "@/types/api";

export function GET() {
  return NextResponse.json<HealthResponse>({ status: "ok", service: "jobflow" });
}

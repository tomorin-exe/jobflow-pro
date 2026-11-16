import { NextRequest, NextResponse } from "next/server";
import { mockJobs } from "@/data/jobs";
import { isJobStatus } from "@/lib/jobs";
import { JOB_STATUSES } from "@/types/job";
import type { ApiErrorResponse, JobsResponse } from "@/types/api";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const status = params.get("status");

  // 未传参数才表示全部；空字符串及重复参数都视为不合法请求。
  if (params.getAll("status").length > 1 || (status !== null && !isJobStatus(status))) {
    return NextResponse.json<ApiErrorResponse>(
      {
        error: {
          code: "INVALID_STATUS",
          message: `status 参数只能出现一次，且必须是以下值之一：${JOB_STATUSES.join("、")}。`,
        },
      },
      { status: 400 },
    );
  }

  // 只读取服务端模拟数据；filter 不会修改原数组。
  const data = status === null ? mockJobs : mockJobs.filter((job) => job.status === status);
  return NextResponse.json<JobsResponse>({ data, total: data.length });
}

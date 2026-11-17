import { NextRequest } from "next/server";
import { jobJson, jobStatusParameter, readJobBody, withJobApi } from "@/lib/job-api";
import type { PersonalJobResponse, PersonalJobsResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return withJobApi(request, async (repository) => {
    const data = await repository.getAllJobs(jobStatusParameter(request.nextUrl.searchParams));
    return jobJson<PersonalJobsResponse>({ data, total: data.length });
  });
}

export function POST(request: NextRequest) {
  return withJobApi(request, async (repository) => {
    const data = await repository.createJob(await readJobBody(request, "create"));
    return jobJson<PersonalJobResponse>({ data }, 201, { Location: `/api/me/jobs/${data.id}` });
  });
}

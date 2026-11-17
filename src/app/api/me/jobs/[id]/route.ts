import { NextRequest } from "next/server";
import { JobApiError, jobJson, readJobBody, withJobApi } from "@/lib/job-api";
import type { PersonalJobResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export function GET(request: NextRequest, { params }: Context) {
  return withJobApi(request, async (repository) => {
    const { id } = await params;
    const data = await repository.getJobById(id);
    if (!data) throw new JobApiError("JOB_NOT_FOUND");
    return jobJson<PersonalJobResponse>({ data });
  });
}

export function PATCH(request: NextRequest, { params }: Context) {
  return withJobApi(request, async (repository) => {
    const { id } = await params;
    const data = await repository.updateJob(id, await readJobBody(request, "patch"));
    if (!data) throw new JobApiError("JOB_NOT_FOUND");
    return jobJson<PersonalJobResponse>({ data });
  });
}

export function DELETE(request: NextRequest, { params }: Context) {
  return withJobApi(request, async (repository) => {
    const { id } = await params;
    const data = await repository.deleteJob(id);
    if (!data) throw new JobApiError("JOB_NOT_FOUND");
    return jobJson<PersonalJobResponse>({ data });
  });
}

import { jobJson, withJobApi } from "@/lib/job-api";
import { readImportBody } from "@/lib/job-import-body";
import { getPrisma } from "@/lib/prisma";
import { createJobImportRepository } from "@/repositories/job-import-repository";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return withJobApi(request, async (_repository, userId) => {
    const result = await createJobImportRepository(getPrisma, async () => userId).import(await readImportBody(request));
    return jobJson({ data: result }, result.replayed ? 200 : 201);
  });
}

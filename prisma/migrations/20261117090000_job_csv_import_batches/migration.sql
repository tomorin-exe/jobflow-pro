-- Additive migration: preserve all existing users and jobs.
BEGIN;

-- CreateTable
CREATE TABLE "job_import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "jobIds" UUID[],
    "rowNumbers" INTEGER[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_import_batches_userId_createdAt_idx" ON "job_import_batches"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "job_import_batches_userId_requestId_key" ON "job_import_batches"("userId", "requestId");

-- AddForeignKey
ALTER TABLE "job_import_batches" ADD CONSTRAINT "job_import_batches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;

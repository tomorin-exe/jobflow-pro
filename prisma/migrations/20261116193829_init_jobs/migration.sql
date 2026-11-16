-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('applied', 'interviewing', 'offered', 'rejected');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "company" VARCHAR(100) NOT NULL,
    "position" VARCHAR(100) NOT NULL,
    "location" VARCHAR(100) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'applied',
    "appliedAt" DATE NOT NULL,
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_appliedAt_idx" ON "jobs"("appliedAt" DESC);

-- CreateIndex
CREATE INDEX "jobs_status_appliedAt_idx" ON "jobs"("status", "appliedAt" DESC);

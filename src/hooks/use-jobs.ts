"use client";

import { useState, useSyncExternalStore } from "react";
import { createJobsStore } from "@/lib/job-storage";
import type { Job } from "@/types/job";

export function useJobs(initialJobs: readonly Job[]) {
  const [store] = useState(() => createJobsStore(initialJobs));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return {
    ...snapshot,
    createJob: store.create,
    updateJob: store.update,
    deleteJob: store.remove,
    retry: store.reload,
    resetCorruptData: store.resetCorruptData,
  };
}

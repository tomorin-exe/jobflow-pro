"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createRemoteJobsStore } from "@/lib/remote-jobs-store";
import { authClient } from "@/lib/auth-client";

export function useRemoteJobs(viewerId: string) {
  const [store] = useState(() => createRemoteJobsStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const viewer = authClient.useSession();
  const currentUserId = viewer.data?.user.id;
  useEffect(() => {
    void store.start();
    return () => store.stop();
  }, [store]);
  useEffect(() => {
    // 只用于清理旧账号的客户端视图，访问权限仍由页面和每次 API 请求在服务器校验。
    if (!viewer.isPending && !viewer.error && currentUserId !== viewerId) {
      store.expire();
      if (currentUserId) window.location.replace("/dashboard");
    }
  }, [store, viewerId, currentUserId, viewer.isPending, viewer.error]);
  return { ...snapshot, createJob: store.createJob, updateJob: store.updateJob, deleteJob: store.deleteJob, refresh: store.refresh, expire: store.expire };
}

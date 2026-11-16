import type { Job } from "@/types/job";

// 固定的本地演示数据；状态和字段会在编译时接受类型检查。
export const mockJobs = [
  {
    id: "job-001",
    company: "字节跳动",
    position: "前端开发工程师",
    location: "北京 · 朝阳区",
    status: "interviewing",
    appliedAt: "2026-11-16",
  },
  {
    id: "job-002",
    company: "腾讯",
    position: "React 开发工程师",
    location: "深圳 · 南山区",
    status: "applied",
    appliedAt: "2026-11-15",
  },
  {
    id: "job-003",
    company: "小红书",
    position: "全栈开发工程师",
    location: "上海 · 黄浦区",
    status: "interviewing",
    appliedAt: "2026-11-14",
  },
  {
    id: "job-004",
    company: "阿里巴巴",
    position: "前端开发工程师",
    location: "杭州 · 余杭区",
    status: "offered",
    appliedAt: "2026-11-12",
  },
  {
    id: "job-005",
    company: "网易",
    position: "Web 开发工程师",
    location: "杭州 · 滨江区",
    status: "applied",
    appliedAt: "2026-11-11",
  },
  {
    id: "job-006",
    company: "美团",
    position: "前端开发工程师",
    location: "北京 · 朝阳区",
    status: "interviewing",
    appliedAt: "2026-11-10",
  },
  {
    id: "job-007",
    company: "哔哩哔哩",
    position: "前端开发工程师",
    location: "上海 · 杨浦区",
    status: "applied",
    appliedAt: "2026-11-08",
  },
  {
    id: "job-008",
    company: "米哈游",
    position: "Web 前端工程师",
    location: "上海 · 徐汇区",
    status: "rejected",
    appliedAt: "2026-11-06",
  },
] satisfies Job[];

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "投递总览 · JobFlow Pro",
  description: "JobFlow Pro 求职投递管理系统，清晰记录每次投递，追踪从申请到录用的每一步。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

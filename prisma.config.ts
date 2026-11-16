import nextEnv from "@next/env";
import { defineConfig } from "prisma/config";

// Prisma CLI 在 Next.js 之外运行，显式使用相同的 .env* 加载器读取 .env.local。
// 不输出配置内容或包含真实连接信息的解析错误。
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", {
  info: () => {},
  error: () => { throw new Error("无法加载环境变量文件，请检查本地配置。"); },
});

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // generate、validate 和离线 diff 不需要连接地址。
  // 未来真正连接数据库的命令仍必须由用户提供 DATABASE_URL。
  datasource: { url: databaseUrl ?? "" },
});

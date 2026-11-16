import "server-only";

export type DatabaseErrorCode = "CONFIGURATION_ERROR" | "INVALID_INPUT" | "INVALID_ID" | "DATABASE_UNAVAILABLE";

const messages: Record<DatabaseErrorCode, string> = {
  CONFIGURATION_ERROR: "数据库配置不可用，请检查服务端连接配置。",
  INVALID_INPUT: "岗位信息不完整或格式不正确。",
  INVALID_ID: "岗位 ID 必须是有效的 UUID。",
  DATABASE_UNAVAILABLE: "数据库暂时不可用，请稍后重试。",
};

/** 可交给上层处理的安全错误。不携带原始异常、连接串或数据库错误详情。 */
export class DatabaseAccessError extends Error {
  readonly code: DatabaseErrorCode;

  constructor(code: DatabaseErrorCode, message = messages[code]) {
    super(message);
    this.name = "DatabaseAccessError";
    this.code = code;
  }
}

export async function withDatabaseErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DatabaseAccessError) throw error;
    // 不把 error.message、stack、cause 或 Prisma meta 传递给调用者。
    throw new DatabaseAccessError("DATABASE_UNAVAILABLE");
  }
}

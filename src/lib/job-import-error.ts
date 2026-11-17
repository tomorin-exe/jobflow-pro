const errors = {
  CSV_INVALID: [400, "CSV 格式不正确，请检查引号、列数和 UTF-8 编码。"],
  CSV_HEADERS: [400, "表头不正确：需要公司、职位、地点、状态、投递日期；备注可选。请勿重复或添加其他列。"],
  CSV_LIMIT: [413, "CSV 最多 256 KiB、500 条记录，每条记录最多 8192 个字符。"],
  IMPORT_INVALID: [400, "请预览 CSV，并选择至少一条有效记录；检查行号、确认选项和请求格式。"],
  IMPORT_DUPLICATES: [409, "所选记录存在疑似重复，请明确确认保留为新岗位后再导入。"],
  IMPORT_PREVIEW_STALE: [409, "相关岗位已发生变化，请重新预览并确认导入内容。"],
  IMPORT_KEY_CONFLICT: [409, "此批次标识已用于其他内容，请重新预览后创建新批次。"],
  IMPORT_MIGRATION_REQUIRED: [503, "导入功能的数据库迁移尚未就绪，请联系维护者。"],
} as const;
export type JobImportErrorCode = keyof typeof errors;
export class JobImportError extends Error {
  constructor(readonly code: JobImportErrorCode, readonly line?: number) {
    super(errors[code][1] + (line ? `（第 ${line} 行）` : ""));
  }
  get status() { return errors[this.code][0]; }
}

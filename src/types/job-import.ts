import type { JobInput } from "@/types/job";

/** 预览必须能表示非法状态，不能冒充已经有效的 JobInput。 */
export type CsvJobInput = Omit<JobInput, "status"> & { status: string };

export interface CsvRow {
  /** CSV 中的实际起始行号，包含表头、空行和引号中的换行。 */
  line: number;
  input: CsvJobInput;
  errors: string[];
}
export interface ImportPreviewRow extends CsvRow {
  csvDuplicateLines: number[];
  existingCount: number;
}
export interface ImportPreview {
  rows: ImportPreviewRow[];
  previewHash: string;
}
export interface JobImportRequest {
  csv: string;
  selectedRows: number[];
  allowDuplicates: boolean;
  previewHash: string;
  requestId: string;
}
export interface JobImportResult {
  batchId: string;
  importedCount: number;
  jobIds: string[];
  rowNumbers: number[];
  replayed: boolean;
}

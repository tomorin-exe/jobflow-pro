import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { JobMutationResult } from "@/types/job";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => JobMutationResult;
  onCancel: () => void;
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title={title} description={description} role="alertdialog" onClose={onCancel}>
      <div className="min-h-0 overflow-y-auto p-5 sm:p-6">
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button data-autofocus type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2.5 text-sm text-secondary hover:bg-[#f4f6f4]">取消</button>
          <button type="button" onClick={() => { const result = onConfirm(); if (!result.ok) setError(result.error); }} className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700">{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

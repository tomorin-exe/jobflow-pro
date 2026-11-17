import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

interface ModalProps {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  role?: "dialog" | "alertdialog";
  busy?: boolean;
  wide?: boolean;
}

export function Modal({ title, description, children, onClose, role = "dialog", busy = false, wide = false }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousGutter = root.style.scrollbarGutter;
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      dialog.close();
      root.style.overflow = previousOverflow;
      root.style.scrollbarGutter = previousGutter;
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      role={role}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      aria-busy={busy}
      className={`fixed top-1/2 right-auto bottom-auto left-1/2 m-0 max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] ${wide ? "max-w-5xl" : "max-w-lg"} -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-line bg-white p-0 text-primary shadow-2xl backdrop:bg-primary/35`}
    >
      <div className="flex max-h-[calc(100dvh_-_2.25rem)] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            <p id={descriptionId} className="mt-1.5 text-xs leading-5 text-secondary [overflow-wrap:anywhere]">{description}</p>
          </div>
          <button type="button" aria-label="关闭弹窗" onClick={onClose} disabled={busy} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-brand-light">
            <Icon name="close" className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

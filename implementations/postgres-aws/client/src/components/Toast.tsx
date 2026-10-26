import { useEffect, useState } from 'react';

export interface ToastMessage {
  message: string;
  undo?: () => Promise<unknown>;
}

// A short-lived message at the bottom of the screen, cleared after a while.
export function useToast(timeoutMs = 8000) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [toast, timeoutMs]);
  return [toast, setToast] as const;
}

export function Toast({ toast, onUndo }: { toast: ToastMessage | null; onUndo: (undo: () => Promise<unknown>) => void }) {
  if (!toast) {
    return null;
  }
  const { undo } = toast;
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {undo && (
        <button type="button" className="toast__undo" onClick={() => onUndo(undo)}>
          Undo
        </button>
      )}
    </div>
  );
}

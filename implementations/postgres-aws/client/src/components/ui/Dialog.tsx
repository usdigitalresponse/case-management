import { useEffect, useRef, type ReactNode } from 'react';
import { TourDialogHint } from '../../tour/GuidePanel';

// A modal confirmation over the page, as in the design: a native <dialog>,
// so focus stays inside and Escape closes it.
export function Dialog({
  title,
  children,
  onClose,
  className,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className ? `dialog ${className}` : 'dialog'}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="dialog-title" className="dialog__title">{title}</h2>
      <TourDialogHint />
      {children}
    </dialog>
  );
}

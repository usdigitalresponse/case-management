import { useState } from 'react';

// Asks inline before a destructive action, never with a browser dialog.
export function ConfirmButton({
  label,
  prompt,
  confirmLabel,
  onConfirm,
  disabled,
  compact,
}: {
  label: string;
  prompt: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  // Link-style, for table rows.
  compact?: boolean;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button
        type="button"
        className={compact ? 'link-button link-button--danger' : 'btn btn--danger'}
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-inline" role="group" aria-label={prompt}>
      <span className="confirm-inline__prompt">{prompt}</span>
      <button
        type="button"
        className="btn btn--danger"
        disabled={disabled}
        ref={(element: HTMLButtonElement | null) => element?.focus()}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="link-button" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

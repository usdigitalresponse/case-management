import { useState } from 'react';
import { Button } from '@trussworks/react-uswds';

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
      <Button
        type="button"
        secondary={!compact}
        unstyled={compact}
        className={compact ? 'confirm-compact' : undefined}
        disabled={disabled}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <span className="confirm-inline" role="group" aria-label={prompt}>
      <span className="confirm-inline__prompt">{prompt}</span>
      <Button
        type="button"
        secondary
        disabled={disabled}
        ref={(element: HTMLButtonElement | null) => element?.focus()}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button type="button" unstyled onClick={() => setAsking(false)}>
        Cancel
      </Button>
    </span>
  );
}

import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

// A small ✕ beside a file's name that removes the file, after asking.
export function RemoveFileButton({
  fileName,
  onRemove,
  disabled = false,
  consequence,
}: {
  fileName: string;
  onRemove: () => unknown;
  disabled?: boolean;
  // What removing it does; the default suits a file chosen but not yet sent.
  consequence?: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button type="button" className="file-remove" aria-label={`Remove ${fileName}`} disabled={disabled} onClick={() => setConfirming(true)}>
        ✕
      </button>
      {confirming && (
        <Dialog title="Remove this file?" onClose={() => setConfirming(false)}>
          <p>{consequence ?? <>{fileName} won’t be attached. You can choose it again.</>}</p>
          <div className="dialog__actions">
            <Button
              kind="danger"
              onClick={() => {
                setConfirming(false);
                void onRemove();
              }}
            >
              Remove file
            </Button>
            <button type="button" className="link-button" onClick={() => setConfirming(false)} autoFocus>
              Keep it
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

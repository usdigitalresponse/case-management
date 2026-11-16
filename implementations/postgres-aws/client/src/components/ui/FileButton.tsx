import type { ReactNode } from 'react';
import { buttonClass } from './Button';
import { RemoveFileButton } from './RemoveFileButton';

// A file field shown as a secondary "Choose file" button (design K), with the chosen file's name beside it.
export function FileButton({
  id,
  accept,
  disabled = false,
  fileName,
  onChoose,
  onRemove,
  children = 'Choose file',
}: {
  id?: string;
  accept: string;
  disabled?: boolean;
  fileName?: string | null;
  onChoose: (file: File) => void;
  // Shows a ✕ beside the file name that removes it, after asking.
  onRemove?: () => void;
  children?: ReactNode;
}) {
  return (
    <span className="file-button">
      <label className={buttonClass('secondary', { className: 'file-button__button' })} aria-disabled={disabled || undefined}>
        {children}
        <input
          id={id}
          type="file"
          className="usa-sr-only"
          accept={accept}
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onChoose(file);
          }}
        />
      </label>
      {fileName && (
        <span className="file-name">
          {fileName}
          {onRemove && <RemoveFileButton fileName={fileName} onRemove={onRemove} disabled={disabled} />}
        </span>
      )}
    </span>
  );
}

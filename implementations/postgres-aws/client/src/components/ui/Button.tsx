import { forwardRef, type ButtonHTMLAttributes } from 'react';

// Ghost buttons are .link-button for now.
export type ButtonKind = 'primary' | 'secondary' | 'danger';

// For a link that looks like a button.
export function buttonClass(kind: ButtonKind, { small = false, className }: { small?: boolean; className?: string } = {}) {
  return ['btn', `btn--${kind}`, small && 'btn--small', className].filter(Boolean).join(' ');
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind; small?: boolean }>(
  function Button({ kind = 'secondary', small, className, type = 'button', ...rest }, ref) {
    return <button ref={ref} type={type} className={buttonClass(kind, { small, className })} {...rest} />;
  },
);

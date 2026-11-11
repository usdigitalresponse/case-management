import type { ReactNode } from 'react';
import type { Tone } from './Tag';

// The outcome of a save, shown in a Notice.
export interface SaveMessage {
  tone: 'danger' | 'success';
  text: string;
}

// The design system's Alert icon for each tone; the words carry the meaning.
const ICONS = { info: 'i', success: '✓', warning: '!', danger: '×' } as const;

// One message box for the whole app: a tinted bar with an optional heading
// and an action on the right. Errors are announced as they appear.
export function Notice({
  tone,
  heading,
  action,
  className,
  children,
}: {
  tone: Exclude<Tone, 'neutral' | 'strong'>;
  heading?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`notice notice--${tone}${className ? ` ${className}` : ''}`} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="notice__icon" aria-hidden="true">{ICONS[tone]}</span>
      <div className="notice__body">
        {heading && <strong className="notice__heading">{heading}</strong>}
        {children}
      </div>
      {action && <div className="notice__action">{action}</div>}
    </div>
  );
}

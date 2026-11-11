import type { ButtonHTMLAttributes, ReactNode } from 'react';

// The design system's Tag: a short label whose text carries the meaning; tone only adds color.
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function Tag({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children?: ReactNode }) {
  return <span className={['tag', `tag--${tone}`, className].filter(Boolean).join(' ')}>{children}</span>;
}

// A Tag that filters a list; pressed while its filter is on.
export function FilterTag({
  tone,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return <button type={type} className={['tag', 'tag--filter', tone && `tag--${tone}`, className].filter(Boolean).join(' ')} {...rest} />;
}

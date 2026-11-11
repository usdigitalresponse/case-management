import type { CSSProperties } from 'react';

// Hands a value known only at run time to the stylesheet, which does the styling.
export function cssVars(vars: Record<`--${string}`, string | number>): CSSProperties {
  return vars as CSSProperties;
}

import type { ReactNode } from 'react';
import { cssVars } from './ui/cssVars';

// The strip of key facts under a page's title.
export function FactsStrip({ children }: { children: ReactNode }) {
  return <dl className="card facts-strip">{children}</dl>;
}

export function Fact({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {children}
        {note && <span className="cell-note">{note}</span>}
      </dd>
    </div>
  );
}

// "3 of 5" with a bar, for lines decided.
export function Progress({ done, total }: { done: number; total: number }) {
  return (
    <>
      {done} of {total}
      <span className="progress" aria-hidden="true" style={cssVars({ '--done': `${total ? (done / total) * 100 : 0}%` })}>
        <span />
      </span>
    </>
  );
}

import type { ReactNode } from 'react';
import { Notice } from './ui/Notice';

// CaseList and PortalCaseList each hand-rolled this same error/loading/
// empty/content branching under a shared heading — this is that shape,
// extracted once.
export function ResourceList<T>({
  heading,
  error,
  data,
  errorMessage,
  loadingMessage = 'Loading…',
  emptyMessage,
  empty,
  children,
}: {
  heading: ReactNode;
  error: unknown;
  data: T[] | null;
  errorMessage: string;
  loadingMessage?: string;
  emptyMessage: string;
  // There are none at all, as opposed to none matching; by default, none loaded.
  empty?: boolean;
  children: (data: T[]) => ReactNode;
}) {
  if (error) {
    return (
      <>
        {heading}
        <Notice tone="danger">{errorMessage}</Notice>
      </>
    );
  }
  if (!data) {
    return (
      <>
        {heading}
        <p role="status">{loadingMessage}</p>
      </>
    );
  }
  if (empty ?? data.length === 0) {
    return (
      <>
        {heading}
        <p>{emptyMessage}</p>
      </>
    );
  }
  return (
    <>
      {heading}
      {children(data)}
    </>
  );
}

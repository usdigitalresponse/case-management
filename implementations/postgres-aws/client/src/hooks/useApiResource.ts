import { useEffect, useState } from 'react';

// Shared fetch/loading/error mechanics for a mount-effect data load — used
// by every read screen (CaseList, CaseDetail, NewCaseIntake's reference
// data). Error *message* formatting stays with the caller (e.g. mapping a 404 to
// "Case not found."), since that's genuinely per-page.
export function useApiResource<T>(fetchFn: () => Promise<T>, deps: unknown[]): { data: T | null; error: unknown } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetchFn()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error };
}

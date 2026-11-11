import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

// A filter kept in the address, so Back returns to it; the default is left out.
export function useSearchParamState<T extends string>(name: string, fallback: T, allowed?: readonly T[]): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(name) as T | null;
  const value = raw !== null && (!allowed || allowed.includes(raw)) ? raw : fallback;
  const set = useCallback(
    (next: T) =>
      setParams(
        (current) => {
          const merged = new URLSearchParams(current);
          if (next === fallback) merged.delete(name);
          else merged.set(name, next);
          return merged;
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams, name, fallback],
  );
  return [value, set];
}

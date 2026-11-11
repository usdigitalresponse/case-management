import { useCallback, useEffect, useRef, useState } from 'react';
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

// Typing waits this long before the address follows.
const TYPING_PAUSE_MS = 300;

// A text box kept in the address: typed into locally, so the cursor stays put,
// written to the address after a pause, and following it when it changes elsewhere.
export function useSearchParamText(name: string): [string, (next: string) => void] {
  const [stored, setStored] = useSearchParamState<string>(name, '');
  const [text, setText] = useState(stored);
  const written = useRef(stored);
  useEffect(() => {
    if (stored === written.current) return;
    written.current = stored;
    setText(stored);
  }, [stored]);
  useEffect(() => {
    if (text === written.current) return undefined;
    const timer = window.setTimeout(() => {
      written.current = text;
      setStored(text);
    }, TYPING_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [text, setStored]);
  return [text, setText];
}

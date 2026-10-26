import { ApiError } from '../api/client';
import { Notice } from './Notice';

// What a page shows before its data arrives: loading, not found or failed.
export function LoadState({ error, what }: { error: unknown; what: string }) {
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return <Notice tone="danger">{notFound ? `${what[0]?.toUpperCase()}${what.slice(1)} not found.` : `Failed to load ${what}.`}</Notice>;
  }
  return <p role="status">Loading {what}…</p>;
}

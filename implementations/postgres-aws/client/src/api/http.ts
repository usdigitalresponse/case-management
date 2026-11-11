// Thin fetch wrapper — no business logic here, only HTTP mechanics. The
// server (../../server/src/routes) owns validation and business rules.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// Dispatched on window after a successful change, so views that summarize
// other pages' data (the sidebar counts) can reload.
export const DATA_CHANGED_EVENT = 'api:data-changed';

// `notifies`: false for a POST that only reads, so summaries aren't reloaded.
export async function request<T>(path: string, init?: RequestInit, { notifies = Boolean(init?.method && init.method !== 'GET') } = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  if (notifies) {
    window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  }
  return body as T;
}

export async function fileBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new ApiError(response.status, undefined);
  }
  return response.arrayBuffer();
}

// A file as the raw request body, its name in a header.
export async function sendFile<T>(path: string, file: File): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    body: file,
  });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
  return body as T;
}

export interface ValidationErrorBody {
  error: 'validation_error';
  fieldErrors: Record<string, string>;
}

function isValidationErrorBody(body: unknown): body is ValidationErrorBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { error?: unknown }).error === 'validation_error'
  );
}

// The field errors a request was refused with (or that an error carries
// already, as NewCaseError does); empty if none.
export function fieldErrorsOf(err: unknown): Record<string, string> {
  if (err instanceof ApiError) {
    return isValidationErrorBody(err.body) ? err.body.fieldErrors : {};
  }
  const carried = (err as { fieldErrors?: unknown } | null)?.fieldErrors;
  return carried && typeof carried === 'object' ? (carried as Record<string, string>) : {};
}

// The server's message for a 4xx, when it sent one.
export function apiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string; fieldErrors?: Record<string, string> } | undefined;
    const fieldMessage = body?.fieldErrors ? Object.values(body.fieldErrors)[0] : undefined;
    return fieldMessage ?? body?.message ?? fallback;
  }
  return fallback;
}

export function fieldError(err: unknown, field: string): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  return (err.body as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors?.[field];
}

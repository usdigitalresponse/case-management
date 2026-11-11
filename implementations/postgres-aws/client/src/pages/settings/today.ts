// Today's date, as rates' effective dates are written.
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

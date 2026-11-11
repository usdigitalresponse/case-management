// Today's date in the viewer's zone, as rates' effective dates are written.
export function today(): string {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
}

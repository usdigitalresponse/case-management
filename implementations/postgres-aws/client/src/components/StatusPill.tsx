// Color by status code; the text always carries the meaning.
export function StatusPill({ code, label }: { code?: string | null; label: string | null }) {
  const variant = code ? ` status-pill--${code.replace(/[^a-z_]/g, '')}` : '';
  return <span className={`status-pill${variant}`}>{label ?? 'Unknown'}</span>;
}

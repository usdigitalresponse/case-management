export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATUS_TONE: Record<string, Tone> = {
  submitted: 'info',
  under_review: 'info',
  awaiting_sign_off: 'info',
  approved: 'success',
  every_line_decided: 'success',
  approved_in_part: 'warning',
  pending: 'warning',
  rejected: 'danger',
};

// A status as the design's chip, colored by status code or an explicit tone;
// the text always carries the meaning.
export function StatusPill({ code, tone, label }: { code?: string | null; tone?: Tone; label: string | null }) {
  return <span className={`chip chip--${tone ?? ((code && STATUS_TONE[code]) || 'neutral')}`}>{label ?? 'Unknown'}</span>;
}

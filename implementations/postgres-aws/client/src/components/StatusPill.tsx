import { Tag, type Tone } from './ui/Tag';

export type { Tone };

const STATUS_TONE: Record<string, Tone> = {
  awaiting_match: 'warning',
  submitted: 'info',
  under_review: 'info',
  awaiting_answer: 'warning',
  awaiting_sign_off: 'info',
  approved: 'success',
  every_line_decided: 'success',
  approved_in_part: 'warning',
  pending: 'warning',
  rejected: 'danger',
};

// A status as the design's Tag, colored by status code or an explicit tone;
// the text always carries the meaning.
export function StatusPill({ code, tone, label }: { code?: string | null; tone?: Tone; label: string | null }) {
  return <Tag tone={tone ?? ((code && STATUS_TONE[code]) || 'neutral')}>{label ?? 'Unknown'}</Tag>;
}

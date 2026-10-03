import type { CaseStage } from './api/client';

// Each stage's destination: Billing has its own queue; the rest have no
// page of their own, so they land on the case list pre-filtered via
// ?stage=<id> (./pages/CaseList.tsx reads it).
export const overviewStages: { id: CaseStage; label: string; description: string; route: string }[] = [
  {
    id: 'needs-assignment',
    label: 'Needs assignment',
    description: 'Cases waiting for their next step.',
    route: '/cases?stage=needs-assignment',
  },
  {
    id: 'represented',
    label: 'Represented',
    description: 'Follow active case work and upcoming activity.',
    route: '/cases?stage=represented',
  },
  { id: 'billing', label: 'Billing', description: 'Track payment requests and their review.', route: '/billing' },
  {
    id: 'closing',
    label: 'Closing',
    description: 'Complete the final steps before closing a case.',
    route: '/cases?stage=closing',
  },
];

// A closed case (stage: null) has left the working board entirely — see
// server/src/cases/caseStage.ts. An unrecognized value (e.g. a typo'd
// ?stage= param) is shown as-is.
export function stageLabel(stage: string | null): string {
  if (!stage) return 'Closed';
  return overviewStages.find((s) => s.id === stage)?.label ?? stage;
}

import type { CaseStage } from './api/client';

// Each stage lands on the case list pre-filtered via ?stage=<id>
// (./pages/CaseList.tsx reads it).
export const overviewStages: { id: CaseStage; label: string; description: string; route: string }[] = [
  {
    id: 'needs-assignment',
    label: 'Needs assignment',
    description: 'An invoice came in and no reviewer is assigned yet.',
    route: '/cases?stage=needs-assignment',
  },
  { id: 'represented', label: 'Represented', description: 'Active work, no invoice waiting.', route: '/cases?stage=represented' },
  { id: 'billing', label: 'Billing', description: 'An invoice is waiting for review or sign-off.', route: '/cases?stage=billing' },
  { id: 'closing', label: 'Closing', description: 'Final steps before the case closes.', route: '/cases?stage=closing' },
];

// A closed case (stage: null) has left the working board entirely — see
// server/src/cases/caseStage.ts. An unrecognized value (e.g. a typo'd
// ?stage= param) is shown as-is.
export function stageLabel(stage: string | null): string {
  if (!stage) return 'Closed';
  return overviewStages.find((s) => s.id === stage)?.label ?? stage;
}

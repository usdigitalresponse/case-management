import type { CaseStage } from './api/client';

// Each stage links to the case list filtered by ?stage=<id>.
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

// A closed case's stage is null (server/src/cases/caseStage.ts); an unknown ?stage= shows as given.
export function stageLabel(stage: string | null): string {
  if (!stage) return 'Closed';
  return overviewStages.find((s) => s.id === stage)?.label ?? stage;
}

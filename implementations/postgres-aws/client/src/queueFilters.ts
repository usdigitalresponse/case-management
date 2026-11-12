// To review's filters; the server applies them (its reviewQueueBatches.ts).
export const QUEUE_FILTERS = [
  { id: 'everyone', label: "Everyone's" },
  { id: 'mine', label: 'Assigned to you' },
  { id: 'unassigned', label: 'Not assigned yet' },
  { id: 'flagged', label: 'Has a flag' },
] as const;
export type QueueFilterId = (typeof QUEUE_FILTERS)[number]['id'];

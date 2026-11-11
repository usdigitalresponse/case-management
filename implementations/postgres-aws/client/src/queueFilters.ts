import type { ReviewQueueItem } from './api/client';

// The filter tags over both review queues.
export const QUEUE_FILTERS = [
  { id: 'everyone', label: "Everyone's" },
  { id: 'mine', label: 'Assigned to you' },
  { id: 'unassigned', label: 'Not assigned yet' },
  { id: 'flagged', label: 'Has a flag' },
] as const;
export type QueueFilterId = (typeof QUEUE_FILTERS)[number]['id'];

export function matchesQueueFilter(invoice: ReviewQueueItem, filter: QueueFilterId, userAccountId: string): boolean {
  switch (filter) {
    case 'mine':
      return invoice.holder?.userAccountId === userAccountId;
    case 'unassigned':
      return !invoice.reviewer;
    case 'flagged':
      return invoice.flags.length > 0;
    default:
      return true;
  }
}

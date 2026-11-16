import { describe, expect, it } from 'vitest';
import { preauthorizationRequestsRequest } from './caseRequests';

describe('the pre-authorizations request', () => {
  it('opens on All, groups statuses into In review and Decided, and keeps the other filters', () => {
    expect(preauthorizationRequestsRequest(new URLSearchParams('status=unknown'))).toEqual({
      tab: 'all',
      filter: { status: '', countyId: undefined, caseId: undefined },
    });
    expect(preauthorizationRequestsRequest(new URLSearchParams('status=in_review&caseId=c1'))).toEqual({
      tab: 'in_review',
      filter: { status: 'in_review', countyId: undefined, caseId: 'c1' },
    });
    // A link from before design K names one status.
    expect(preauthorizationRequestsRequest(new URLSearchParams('status=denied')).tab).toBe('decided');
  });
});

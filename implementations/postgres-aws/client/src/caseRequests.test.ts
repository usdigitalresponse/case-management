import { describe, expect, it } from 'vitest';
import { preauthorizationRequestsRequest } from './caseRequests';

describe('the pre-authorizations request', () => {
  it('opens on Waiting, lists every status for All and keeps the other filters', () => {
    expect(preauthorizationRequestsRequest(new URLSearchParams('status=unknown'))).toEqual({
      tab: 'submitted',
      filter: { status: 'submitted', countyId: undefined, caseId: undefined },
    });
    expect(preauthorizationRequestsRequest(new URLSearchParams('status=all&caseId=c1'))).toEqual({
      tab: 'all',
      filter: { status: '', countyId: undefined, caseId: 'c1' },
    });
  });
});

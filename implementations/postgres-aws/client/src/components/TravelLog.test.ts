import { describe, expect, it } from 'vitest';
import type { PortalInvoiceLine } from '../api/client';
import { overRouteNote } from './TravelLog';

const mileage = (quantity: string, routeDistance: string | null, roundTrip: boolean) =>
  ({ quantity, routeDistance, roundTrip }) as PortalInvoiceLine;

describe('a mileage line over the driving route', () => {
  it('says the route and how far over, doubling the route for a round trip', () => {
    expect(overRouteNote(mileage('30', '5.6', true))).toBe('Driving route is 11.2 mi. 18.8 mi more claimed, over tolerance.');
    expect(overRouteNote(mileage('10', '4.3', false))).toBe('Driving route is 4.3 mi. 5.7 mi more claimed, over tolerance.');
  });

  it('says nothing when the route wasn’t looked up', () => {
    expect(overRouteNote(mileage('30', null, true))).toBeNull();
  });
});

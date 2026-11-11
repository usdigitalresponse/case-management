import { request } from './http';
import type { AuthenticatedUser } from './auth';

export type TourMission = 'staff-filing' | 'preauth-send' | 'review' | 'answer-finish' | 'sign-off';
export type TourRole = 'staff' | 'director' | 'vendor';

// Mirrors server/src/demoTour/tourMaterial.ts TourRun, less ids only its tests read.
export interface TourRun {
  runId: string;
  mission: TourMission;
  caseId?: string;
  caseNumber?: string;
  clientName?: string;
  vendorName: string;
  invoiceId?: string;
  sample?: { invoiceNumber: string; periodStart: string; periodEnd: string };
}

export type TourSuggestions = Record<string, string | number | Array<Record<string, string | number>>>;

export interface TourStart {
  run: TourRun;
  suggestions: TourSuggestions;
  user: AuthenticatedUser;
  // The role signed in as, the mission's first.
  role: TourRole;
}

// Makes the mission's own synthetic material and signs in as its first role.
export function startTour(mission: TourMission): Promise<TourStart> {
  return request<TourStart>('/auth/demo-tour/start', { method: 'POST', body: JSON.stringify({ mission }) }, { notifies: false });
}

export function switchTourRole(role: TourRole): Promise<AuthenticatedUser> {
  return request<AuthenticatedUser>('/auth/demo-tour/switch', { method: 'POST', body: JSON.stringify({ role }) }, { notifies: false });
}

export const TOUR_SAMPLE_INVOICE_URL = '/auth/demo-tour/sample-invoice.pdf';

// The guided tour's state, kept per browser tab so it survives the sign-in
// switches between roles and a reload. Pure, for tests.
import type { RequestSucceeded } from '../api/http';
import type { TourMission, TourRole, TourRun, TourSuggestions } from '../api/client';
import { MISSIONS, type TourContextValues, type TourStep } from './missions';

export interface TourState {
  // One mission, or the full story's in order.
  missions: TourMission[];
  part: number;
  step: number;
  run: TourRun;
  suggestions: TourSuggestions;
  role: TourRole;
  vars: Record<string, string>;
  // The different records changed so far for the current step, by path.
  matched: string[];
  // Steps done, by mission, for the finish summary.
  completed: string[];
  collapsed: boolean;
  // Left by the visitor; "Resume tour" brings it back.
  hidden: boolean;
}

const STORAGE_KEY = 'guided-tour';

export function loadTour(): TourState | null {
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as TourState) : null;
  } catch {
    return null;
  }
}

export function saveTour(state: TourState | null): void {
  try {
    if (state) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the tour still runs; it just won't survive a reload.
  }
}

export const missionOf = (state: TourState) => MISSIONS[state.missions[state.part]!];
export const currentStep = (state: TourState): TourStep | undefined => missionOf(state).steps[state.step];
export const contextOf = (state: TourState): TourContextValues => ({ run: state.run, suggestions: state.suggestions, vars: state.vars });
export const missionDone = (state: TourState) => state.step >= missionOf(state).steps.length;
export const storyDone = (state: TourState) => missionDone(state) && state.part >= state.missions.length - 1;

export function advance(state: TourState, captured: Record<string, string> = {}): TourState {
  const step = currentStep(state);
  return {
    ...state,
    step: state.step + 1,
    matched: [],
    vars: { ...state.vars, ...captured },
    completed: step ? [...state.completed, `${missionOf(state).id}:${step.id}`] : state.completed,
  };
}

// The path and search the visitor is on now completes a route step.
export function onLocation(state: TourState, pathname: string): TourState {
  const step = currentStep(state);
  if (!step || !('route' in step.done)) return state;
  return step.done.route(contextOf(state)).test(pathname) ? advance(state) : state;
}

// A change the visitor made completes a request step, once it has reached
// enough different records: deciding one line twice counts once.
export function onRequest(state: TourState, event: RequestSucceeded): TourState {
  const step = currentStep(state);
  if (!step || !('request' in step.done)) return state;
  const wanted = step.done.request;
  if ((wanted.method !== '*' && wanted.method !== event.method) || !wanted.path(contextOf(state)).test(event.path)) return state;
  if (wanted.test && !wanted.test(event.body)) return state;
  const matched = state.matched.includes(event.path) ? state.matched : [...state.matched, event.path];
  if (matched.length < (wanted.times ?? 1)) return { ...state, matched };
  return advance(state, wanted.capture?.(event.response, event.path) ?? {});
}

export function newTour(missions: TourMission[], start: { run: TourRun; suggestions: TourSuggestions }, role: TourRole): TourState {
  return {
    missions,
    part: 0,
    step: 0,
    run: start.run,
    suggestions: start.suggestions,
    role,
    vars: {},
    matched: [],
    completed: [],
    collapsed: false,
    hidden: false,
  };
}

// The next part of the story, on its own fresh material.
export function nextPart(state: TourState, start: { run: TourRun; suggestions: TourSuggestions }, role: TourRole): TourState {
  return { ...state, part: state.part + 1, step: 0, run: start.run, suggestions: start.suggestions, role, vars: {}, matched: [] };
}

// The same mission again, on fresh material.
export function restartPart(state: TourState, start: { run: TourRun; suggestions: TourSuggestions }, role: TourRole): TourState {
  return { ...nextPart(state, start, role), part: state.part };
}

// The guided demo tour (docs/frontend.md "Guided tour"): above both apps,
// so it carries on across the sign-in switches between its roles.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  apiErrorMessage,
  endTour,
  REQUEST_SUCCEEDED_EVENT,
  startTour,
  switchTourRole,
  type RequestSucceeded,
  type TourMission,
  type TourRole,
  type TourStart,
} from '../api/client';
import { useAuth } from '../AuthContext';
import { advance, contextOf, currentStep, loadTour, missionOf, newTour, nextPart, onLocation, onRequest, restartPart, saveTour, type TourState } from './tourState';

interface TourApi {
  state: TourState | null;
  busy: boolean;
  error: string | null;
  start: (missions: TourMission[]) => Promise<void>;
  switchRole: (role: TourRole) => Promise<void>;
  continueStory: () => Promise<void>;
  restartMission: () => Promise<void>;
  completeManually: () => void;
  skip: () => void;
  setCollapsed: (collapsed: boolean) => void;
  leave: () => void;
  resume: () => void;
  end: () => void;
  reportLocation: (pathname: string) => void;
  // Where to go once the next role's pages are showing.
  pendingPath: { path: string; role: TourRole } | null;
  clearPendingPath: () => void;
}

const TourContext = createContext<TourApi | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const { adoptSignIn } = useAuth();
  const [state, setStateRaw] = useState<TourState | null>(() => loadTour());
  const [pendingPath, setPendingPath] = useState<{ path: string; role: TourRole } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setState = useCallback((update: (previous: TourState | null) => TourState | null) => {
    setStateRaw((previous) => {
      const next = update(previous);
      saveTour(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<RequestSucceeded>).detail;
      setState((previous) => (previous && !previous.hidden ? onRequest(previous, detail) : previous));
    };
    window.addEventListener(REQUEST_SUCCEEDED_EVENT, listener);
    return () => window.removeEventListener(REQUEST_SUCCEEDED_EVENT, listener);
  }, [setState]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(apiErrorMessage(err, 'The tour could not go on. Try again.'));
    } finally {
      setBusy(false);
    }
  }, []);

  // Starts a mission's material and signs in as its first role, on that
  // role's home page: the visitor takes the first step themselves. The tour
  // moves on only once the app has taken on that sign-in, so the two agree.
  const begin = useCallback(
    async (mission: TourMission, make: (start: TourStart) => TourState) => {
      const started = await startTour(mission);
      await adoptSignIn();
      setState(() => make(started));
    },
    [adoptSignIn, setState],
  );

  const api = useMemo<TourApi>(
    () => ({
      state,
      busy,
      error,
      start: (missions) => run(() => begin(missions[0]!, (started) => newTour(missions, started, started.role))),
      switchRole: (role) =>
        run(async () => {
          await switchTourRole(role);
          await adoptSignIn();
          setState((previous) => (previous ? { ...previous, role } : previous));
          // After the sign-in, so the next role's app goes there, not the old one.
          const path = state ? currentStep(state)?.path?.(contextOf(state)) : undefined;
          setPendingPath(path ? { path, role } : null);
        }),
      continueStory: () =>
        run(async () => {
          if (!state) return;
          const mission = state.missions[state.part + 1];
          if (mission) await begin(mission, (started) => nextPart(state, started, started.role));
        }),
      restartMission: () =>
        run(async () => {
          if (!state) return;
          await begin(missionOf(state).id, (started) => restartPart(state, started, started.role));
        }),
      completeManually: () =>
        setState((previous) => {
          const step = previous && currentStep(previous);
          return previous && step && 'manual' in step.done ? advance(previous) : previous;
        }),
      skip: () => setState((previous) => (previous && currentStep(previous) ? advance(previous) : previous)),
      setCollapsed: (collapsed) => setState((previous) => (previous ? { ...previous, collapsed } : previous)),
      leave: () => setState((previous) => (previous ? { ...previous, hidden: true } : previous)),
      resume: () => setState((previous) => (previous ? { ...previous, hidden: false, collapsed: false } : previous)),
      end: () => {
        setState(() => null);
        // Best effort: the run also ends at the next sign-in or sign-out.
        void endTour().catch(() => undefined);
      },
      reportLocation: (pathname) => setState((previous) => (previous && !previous.hidden ? onLocation(previous, pathname) : previous)),
      pendingPath,
      clearPendingPath: () => setPendingPath(null),
    }),
    [state, busy, error, run, begin, setState, adoptSignIn, pendingPath],
  );

  return <TourContext.Provider value={api}>{children}</TourContext.Provider>;
}

// Null outside a TourProvider, as in tests that render one page.
export function useTour(): TourApi | null {
  return useContext(TourContext);
}

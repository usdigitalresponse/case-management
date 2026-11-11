import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';

// Navigation state after deleting what was being edited: nothing left to save.
export const DISCARD_EDITS = { discardEdits: true };

// Leaving for another page saves first, so the next page loads after it. If the
// save fails with edits still unsaved, the page stays and leaving again goes
// anyway, until the next edit.
export function useSaveBeforeLeaving({
  unsaved,
  save,
  edits,
  onRefused,
}: {
  unsaved: () => boolean;
  save: () => Promise<boolean>;
  // Changes with each edit.
  edits: unknown;
  onRefused: () => void;
}) {
  const latest = useRef({ unsaved, save, onRefused });
  latest.current = { unsaved, save, onRefused };
  const refused = useRef(false);
  useEffect(() => {
    refused.current = false;
  }, [edits]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      latest.current.unsaved() &&
      !refused.current &&
      currentLocation.pathname !== nextLocation.pathname &&
      (nextLocation.state as typeof DISCARD_EDITS | null)?.discardEdits !== true,
  );
  const saving = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || saving.current) return;
    saving.current = true;
    void latest.current.save().then((saved) => {
      saving.current = false;
      if (saved || !latest.current.unsaved()) {
        blocker.proceed();
      } else {
        refused.current = true;
        latest.current.onRefused();
        blocker.reset();
      }
    });
  }, [blocker]);
}

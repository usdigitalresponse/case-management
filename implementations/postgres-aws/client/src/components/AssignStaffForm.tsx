import { useState } from 'react';
import { Label } from '@trussworks/react-uswds';
import { ApiError, createStaffAssignment, searchStaff, type StaffAccount } from '../api/client';
import { TypeAheadPicker } from './TypeAheadPicker';
import { Notice } from './ui/Notice';
import { Button } from './ui/Button';

// The "assign staff to a case" action behind the needs-assignment ->
// represented transition (server/src/cases/assignStaffToCase.ts).
export function AssignStaffForm({ caseId, onAssigned }: { caseId: string; onAssigned: () => void }) {
  const [selectedStaff, setSelectedStaff] = useState<StaffAccount | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after assigning, to remount TypeAheadPicker and clear it.
  const [resetKey, setResetKey] = useState(0);

  async function handleAssign() {
    if (!selectedStaff) {
      return;
    }
    setAssigning(true);
    setError(null);
    try {
      await createStaffAssignment(caseId, selectedStaff.userAccountId);
      setSelectedStaff(null);
      setResetKey((key) => key + 1);
      onAssigned();
    } catch (err) {
      // 409 is already_assigned or already_closed; the server's message says which.
      const conflictMessage =
        err instanceof ApiError && err.status === 409 ? (err.body as { message?: string } | undefined)?.message : undefined;
      setError(conflictMessage ?? 'Failed to assign staff member.');
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="assign-staff-form">
      <Label htmlFor="staff-query" id="staff-query-label">Assign staff by name or email</Label>
      <div className="assign-staff-row">
        <TypeAheadPicker
          key={resetKey}
          id="staff-query"
          placeholder="Search by name or email"
          noResults="No staff found."
          search={(query) =>
            searchStaff(query).then((result) =>
              result.staff.map((staff) => ({
                value: staff.userAccountId,
                label: `${staff.displayName} (${staff.email})`,
                item: staff,
              })))
          }
          onSelect={(staff) => setSelectedStaff(staff ?? null)}
        />
        <Button kind="primary" disabled={!selectedStaff || assigning} onClick={() => void handleAssign()}>
          {assigning ? 'Assigning…' : 'Assign'}
        </Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

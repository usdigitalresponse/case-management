// One invoice in the portal: its file beside its lines. A draft's lines save
// as they change; once sent they lock, and it can be withdrawn until review
// starts. Filed by person (any invoice without a case, unless told), its case
// number sits at the top and is needed to send, with its county below.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { apiErrorMessage, type PortalInvoice } from '../api/client';
import { useResource } from '../hooks/useResource';
import { myInvoice } from '../resources';
import { LoadState } from '../components/LoadState';
import { Notice } from '../components/ui/Notice';
import { Toast, useToast } from '../components/Toast';
import { useSubmission } from './submission/useSubmission';
import { SubmissionHeader } from './submission/SubmissionHeader';
import { ByPersonDetails } from './submission/ByPersonDetails';
import { SubmissionLines } from './submission/SubmissionLines';
import { SubmissionDialogs } from './submission/SubmissionDialogs';

function Submission(props: Parameters<typeof useSubmission>[0]) {
  const s = useSubmission(props);
  return (
    <div className="submission">
      <SubmissionHeader s={s} />
      {s.facts.byPerson && <ByPersonDetails s={s} />}
      <SubmissionLines s={s} />
      <SubmissionDialogs s={s} />
    </div>
  );
}

export default function InvoiceSubmission({ byPerson }: { byPerson?: boolean }) {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [version, setVersion] = useState(0);
  const { data, error } = useResource(myInvoice(invoiceId as string), { resetKey: version });
  const [shown, setShown] = useState<PortalInvoice | null>(null);
  // Here, so a message (and its Undo) outlives reloading after a send.
  const [toast, setToast] = useToast(6000);
  const [undoError, setUndoError] = useState<string | null>(null);
  // Keeps the page in place while it reloads.
  useEffect(() => {
    if (data) setShown(data);
  }, [data]);

  if (error || !shown) {
    return <LoadState error={error} what="invoice" />;
  }
  return (
    <>
      {undoError && <Notice tone="danger">{undoError}</Notice>}
      {/* Rebuilt when the status changes, so a sent invoice locks its lines. */}
      <Submission
        key={`${shown.invoice.invoiceId}-${shown.invoice.statusCode}`}
        data={shown}
        filedByPerson={byPerson}
        onChanged={() => setVersion((v) => v + 1)}
        setToast={setToast}
      />
      <Toast
        toast={toast}
        onUndo={(undo) =>
          void undo().then(
            () => setToast(null),
            (err: unknown) => setUndoError(apiErrorMessage(err, 'That could not be undone.')),
          )
        }
      />
    </>
  );
}

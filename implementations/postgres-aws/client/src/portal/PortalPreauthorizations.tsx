// A requester's pre-authorization requests (model/rules.yaml request_preauthorization).
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useResource } from '../hooks/useResource';
import { useBatchedResource } from '../hooks/useBatchedResource';
import { MoreOnScroll } from '../components/MoreOnScroll';
import { myCases, myPreauthorizationRequests, requestableProviders } from '../resources';
import { LoadState } from '../components/LoadState';
import { PageHeader } from '../components/PageHeader';
import { RecordTable } from '../components/RecordTable';
import { PreauthorizationRequestForm } from '../components/PreauthorizationRequestForm';
import { requestColumns } from '../components/preauthorizationRequest/requestText';
import { PreauthorizationRequestView } from '../components/PreauthorizationRequestView';

import { PORTAL_PREAUTHORIZATIONS_PATH } from './useShell';
import { Button } from '../components/ui/Button';

function AskForm({ caseId, onCancel }: { caseId: string | undefined; onCancel: () => void }) {
  const navigate = useNavigate();
  const cases = useResource(myCases);
  const providers = useResource(requestableProviders);
  if (!cases.data || !providers.data) return <LoadState error={cases.error ?? providers.error} what="your cases" />;
  const options = cases.data.cases.map((row) => ({ id: row.caseId, label: [row.caseNumber, row.clientDisplayName].filter(Boolean).join(' · ') }));
  return (
    <section className="card compact-card">
      <h2>Ask for pre-authorization</h2>
      <p className="compact-hint">
        Ask before a provider’s work on a case goes past the threshold or what’s pre-authorized. To ask for more, enter the new total.
      </p>
      <PreauthorizationRequestForm
        cases={caseId ? [...options.filter((o) => o.id === caseId), ...options.filter((o) => o.id !== caseId)] : options}
        providers={providers.data.providers.map((row) => ({ id: row.professionalId, label: [row.displayName, row.kindName].filter(Boolean).join(', ') }))}
        onCreated={(created, uploadError) =>
          navigate(`${PORTAL_PREAUTHORIZATIONS_PATH}/${created.preauthorizationRequestId}`, { state: { uploadError } })
        }
        onCancel={onCancel}
      />
    </section>
  );
}

export default function PortalPreauthorizations() {
  const [params, setParams] = useSearchParams();
  const asking = params.has('ask');
  const list = useBatchedResource(myPreauthorizationRequests);
  const columns = requestColumns((requestId) => `${PORTAL_PREAUTHORIZATIONS_PATH}/${requestId}`);
  return (
    <div className="portal-content">
      <PageHeader
        list
        title="Pre-authorizations"
        description="Your requests and the billing office’s answers."
        actions={
          !asking && (
            <Button kind="primary" onClick={() => setParams({ ask: '' }, { preventScrollReset: true })}>
              Ask for pre-authorization
            </Button>
          )
        }
      />
      {asking && (
        <AskForm caseId={params.get('case') ?? undefined} onCancel={() => setParams({}, { preventScrollReset: true })} />
      )}
      {!list.items ? (
        <LoadState error={list.error} what="requests" />
      ) : (
        <RecordTable
          className="queue-table"
          label="Your pre-authorization requests"
          rows={list.items}
          rowKey={(row) => row.preauthorizationRequestId}
          emptyMessage="You haven’t asked for any yet."
          columns={[
            columns.number,
            columns.case,
            columns.provider,
            columns.askedFor,
            columns.approved,
            columns.status,
          ]}
        />
      )}
      <MoreOnScroll list={list} what="requests" />
    </div>
  );
}

export function PortalPreauthorizationRequest() {
  const { requestId } = useParams<{ requestId: string }>();
  return (
    <PreauthorizationRequestView staff={false} requestId={requestId as string} crumbs={[{ label: 'Pre-authorizations', to: PORTAL_PREAUTHORIZATIONS_PATH }]} />
  );
}

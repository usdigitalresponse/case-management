import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Checkbox, ErrorMessage, Fieldset, Form, FormGroup, Label, TextInput } from '@trussworks/react-uswds';
import {
  createCase,
  getReferenceData,
  fieldErrorsOf,
  matchInvoiceToCase,
  searchPeople,
  type PersonRecord,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';
import { ReferenceSelect } from '../components/ReferenceSelect';
import { PageHeader } from '../components/PageHeader';
import { TypeAheadPicker } from '../components/TypeAheadPicker';
import { Notice } from '../components/Notice';
import { INTAKE_PATH } from '../portal/useShell';
import { ProposedPersonFields, SameNameConfirm } from '../components/NewEntryFields';

function generateRequestId(): string {
  return crypto.randomUUID();
}

export default function NewCaseIntake() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const intakeInvoiceId = searchParams.get('intake');
  // Whom that invoice bills, when it was saved without one.
  const intakeProfessionalId = searchParams.get('from') ?? undefined;
  const { data: referenceData, error: loadError } = useApiResource(getReferenceData, []);

  const [selectedPerson, setSelectedPerson] = useState<PersonRecord | null>(null);
  // A client not in the system yet, created with the case.
  const [newClient, setNewClient] = useState<{ displayName: string; email?: string; confirmedNew?: boolean } | null>(null);

  const [participantRoleId, setParticipantRoleId] = useState('');
  const [statusId, setStatusId] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [countyId, setCountyId] = useState('');
  const [caseCategoryId, setCaseCategoryId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [jurisdictionId, setJurisdictionId] = useState('');
  const [preferredLanguageId, setPreferredLanguageId] = useState('');

  const [identifierTypeId, setIdentifierTypeId] = useState('');
  const [identifierIssuer, setIdentifierIssuer] = useState('');
  const [identifierValue, setIdentifierValue] = useState('');
  const [identifierIsPrimary, setIdentifierIsPrimary] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pendingRequest = useRef<{ payload: string; requestId: string } | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setFieldErrors({});

    if (!selectedPerson && !newClient) {
      setFieldErrors({ personId: 'Choose the client, or add them.' });
      return;
    }

    const identifierProvided = identifierTypeId || identifierIssuer || identifierValue;

    setSubmitting(true);
    try {
      const input = {
        personId: newClient ? undefined : selectedPerson?.personId,
        newClient: newClient ? { ...newClient, displayName: newClient.displayName.trim(), email: newClient.email?.trim() || undefined } : undefined,
        participantRoleId,
        statusId,
        effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : '',
        countyId: countyId || undefined,
        caseCategoryId: caseCategoryId || undefined,
        organizationId: organizationId || undefined,
        officeId: officeId || undefined,
        jurisdictionId: jurisdictionId || undefined,
        preferredLanguageId: preferredLanguageId || undefined,
        identifier: identifierProvided
          ? {
              identifierTypeId,
              issuer: identifierIssuer,
              value: identifierValue,
              isPrimary: identifierIsPrimary,
            }
          : undefined,
      };
      const payload = JSON.stringify(input);
      if (pendingRequest.current?.payload !== payload) {
        pendingRequest.current = { payload, requestId: generateRequestId() };
      }
      const result = await createCase({ ...input, requestId: pendingRequest.current.requestId });
      // Started from Intake: match that invoice to the new case, adding its provider.
      if (intakeInvoiceId) {
        try {
          await matchInvoiceToCase(intakeInvoiceId, {
            caseId: result.caseId,
            addMissing: true,
            professionalId: intakeProfessionalId,
          });
          navigate(`${INTAKE_PATH}?matched=${intakeInvoiceId}`);
          return;
        } catch {
          // The case exists; the invoice can still be matched from Intake.
        }
      }
      navigate(`/cases/${result.caseId}`);
    } catch (error) {
      if (Object.keys(fieldErrorsOf(error)).length > 0) {
        setFieldErrors(fieldErrorsOf(error));
      } else {
        setSubmitError('Failed to create case.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const heading = (
    <>
      <PageHeader crumbs={[{ label: 'Cases', to: '/cases' }, { label: 'New case' }]} title="Start a new case" />
      {intakeInvoiceId && (
        <Notice tone="info">
          The invoice from intake is matched to this case when you create it, and its provider is added to the case.
        </Notice>
      )}
      {/* Placeholder: importing cases from another system is planned. */}
      <div className="import-case">
        <button type="button" className="btn btn--outline" disabled title="Not available yet">
          Import a PDF or spreadsheet
        </button>
        <span className="cell-note">Bring in a case from another system. Coming soon; enter the case below for now.</span>
      </div>
    </>
  );

  if (loadError) {
    return (
      <>
        {heading}
        <Notice tone="danger">Failed to load reference data.</Notice>
      </>
    );
  }
  if (!referenceData) {
    return (
      <>
        {heading}
        <p role="status">Loading form…</p>
      </>
    );
  }

  return (
    <>
      {heading}
      <Form className="case-intake-form" onSubmit={(event) => void handleSubmit(event)}>
      <div className="form-card">
      <Fieldset legend="Client" legendStyle="large">
        <FormGroup error={Boolean(fieldErrors.personId)}>
          <Label htmlFor="personQuery" id="personQuery-label">{newClient ? 'Client' : 'Search for an existing person, or add one'}</Label>
          {fieldErrors.personId && <ErrorMessage>{fieldErrors.personId}</ErrorMessage>}
          {newClient ? (
            <div className="new-entry">
              <ProposedPersonFields
                idPrefix="newClient"
                nameLabel="New client’s name"
                value={newClient}
                onChange={(person) => setNewClient({ ...newClient, ...person })}
              />
              <SameNameConfirm
                error={fieldErrors.newClient}
                confirmed={Boolean(newClient.confirmedNew)}
                onChange={(confirmedNew) => setNewClient({ ...newClient, confirmedNew })}
              />
              <button type="button" className="link-button" onClick={() => setNewClient(null)}>Search for an existing person instead</button>
            </div>
          ) : (
            <TypeAheadPicker
              id="personQuery"
              placeholder="Search by name or email"
              noResults="No people found."
              search={(query) =>
                searchPeople(query).then((result) =>
                  result.people.map((person) => ({
                    value: person.personId,
                    label: person.email ? `${person.displayName} (${person.email})` : person.displayName,
                    item: person,
                  })))
              }
              onSelect={(person) => setSelectedPerson(person ?? null)}
              addOption={{ label: '+ Add a new person', onAdd: (query) => setNewClient({ displayName: query }) }}
            />
          )}
        </FormGroup>
      </Fieldset>
      </div>

      <div className="form-card">
      <Fieldset legend="Case opening" legendStyle="large">
        <div className="form-grid">
          <ReferenceSelect
            id="participantRoleId"
            label="Participant role"
            value={participantRoleId}
            onChange={setParticipantRoleId}
            placeholder="Select a role"
            error={fieldErrors.participantRoleId}
            options={referenceData.participantRoles.map((role) => ({ id: role.roleId, label: role.displayName }))}
          />

          <ReferenceSelect
            id="statusId"
            label="Opening status"
            value={statusId}
            onChange={setStatusId}
            placeholder="Select a status"
            error={fieldErrors.statusId}
            options={referenceData.caseStatuses.map((status) => ({ id: status.id, label: status.displayName }))}
          />
        </div>

        <FormGroup error={Boolean(fieldErrors.effectiveAt)}>
          <Label htmlFor="effectiveAt">Effective date and time</Label>
          {fieldErrors.effectiveAt && <ErrorMessage>{fieldErrors.effectiveAt}</ErrorMessage>}
          <input
            id="effectiveAt"
            name="effectiveAt"
            type="datetime-local"
            className="usa-input"
            value={effectiveAt}
            onChange={(event) => setEffectiveAt(event.target.value)}
          />
        </FormGroup>
      </Fieldset>
      </div>

      <div className="form-card">
      <Fieldset legend="Optional context" legendStyle="large">
        <div className="form-grid">
          <ReferenceSelect
            id="countyId"
            label="County"
            error={fieldErrors.countyId}
            value={countyId}
            onChange={setCountyId}
            options={referenceData.counties.map((county) => ({
              id: county.countyId as string,
              label: county.displayName,
            }))}
          />
          <ReferenceSelect
            id="caseCategoryId"
            label="Case category"
            error={fieldErrors.caseCategoryId}
            value={caseCategoryId}
            onChange={setCaseCategoryId}
            options={referenceData.caseCategories.map((category) => ({ id: category.id, label: category.displayName }))}
          />
          <ReferenceSelect
            id="organizationId"
            label="Organization"
            error={fieldErrors.organizationId}
            value={organizationId}
            onChange={(nextOrganizationId) => {
              setOrganizationId(nextOrganizationId);
              // The server rejects an office outside the chosen organization.
              const selectedOffice = referenceData.offices.find((office) => office.officeId === officeId);
              if (nextOrganizationId && selectedOffice?.organizationId !== nextOrganizationId) {
                setOfficeId('');
              }
            }}
            options={referenceData.organizations.map((organization) => ({
              id: organization.organizationId as string,
              label: organization.displayName,
            }))}
          />
          <ReferenceSelect
            id="officeId"
            label="Office"
            error={fieldErrors.officeId}
            value={officeId}
            onChange={setOfficeId}
            options={referenceData.offices
              .filter((office) => !organizationId || office.organizationId === organizationId)
              .map((office) => ({
                id: office.officeId as string,
                label: office.displayName,
              }))}
          />
          <ReferenceSelect
            id="jurisdictionId"
            label="Jurisdiction"
            error={fieldErrors.jurisdictionId}
            value={jurisdictionId}
            onChange={setJurisdictionId}
            options={referenceData.jurisdictions.map((jurisdiction) => ({
              id: jurisdiction.id,
              label: jurisdiction.displayName,
            }))}
          />
          <ReferenceSelect
            id="preferredLanguageId"
            label="Preferred language"
            error={fieldErrors.preferredLanguageId}
            value={preferredLanguageId}
            onChange={setPreferredLanguageId}
            options={referenceData.languages.map((language) => ({ id: language.id, label: language.displayName }))}
          />
        </div>
      </Fieldset>
      </div>

      <div className="form-card">
      <Fieldset legend="Case identifier (optional)" legendStyle="large">
        <div className="form-grid">
          <ReferenceSelect
            id="identifierTypeId"
            label="Identifier type"
            value={identifierTypeId}
            onChange={setIdentifierTypeId}
            error={fieldErrors.identifier ?? fieldErrors['identifier.identifierTypeId']}
            options={referenceData.caseIdentifierTypes.map((type) => ({ id: type.id, label: type.displayName }))}
          />
          <FormGroup error={Boolean(fieldErrors['identifier.issuer'])}>
            <Label htmlFor="identifierIssuer">Issuer</Label>
            {fieldErrors['identifier.issuer'] && <ErrorMessage>{fieldErrors['identifier.issuer']}</ErrorMessage>}
            <TextInput
              id="identifierIssuer"
              name="identifierIssuer"
              type="text"
              value={identifierIssuer}
              onChange={(event) => setIdentifierIssuer(event.target.value)}
            />
          </FormGroup>
          <FormGroup error={Boolean(fieldErrors['identifier.value'])}>
            <Label htmlFor="identifierValue">Value</Label>
            {fieldErrors['identifier.value'] && <ErrorMessage>{fieldErrors['identifier.value']}</ErrorMessage>}
            <TextInput
              id="identifierValue"
              name="identifierValue"
              type="text"
              value={identifierValue}
              onChange={(event) => setIdentifierValue(event.target.value)}
            />
          </FormGroup>
        </div>
        <Checkbox
          id="identifierIsPrimary"
          name="identifierIsPrimary"
          label="Primary identifier"
          checked={identifierIsPrimary}
          onChange={(event) => setIdentifierIsPrimary(event.target.checked)}
        />
      </Fieldset>
      </div>

      {submitError && <Notice tone="danger">{submitError}</Notice>}

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create case'}
        </button>
      </div>
      </Form>
    </>
  );
}

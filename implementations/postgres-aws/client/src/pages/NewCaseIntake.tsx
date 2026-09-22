import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Checkbox,
  ErrorMessage,
  Fieldset,
  Form,
  FormGroup,
  Label,
  Select,
  TextInput,
} from '@trussworks/react-uswds';
import {
  ApiError,
  createCase,
  getReferenceData,
  isValidationErrorBody,
  searchPeople,
  type PersonRecord,
  type ReferenceData,
} from '../api/client';
import { useAuth } from '../AuthContext';

function generateRequestId(): string {
  return crypto.randomUUID();
}

export default function NewCaseIntake() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<PersonRecord[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonRecord | null>(null);

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

  useEffect(() => {
    if (!user) {
      return;
    }
    getReferenceData()
      .then(setReferenceData)
      .catch(() => setLoadError('Failed to load reference data.'));
  }, [user]);

  async function handlePersonSearch() {
    if (!personQuery.trim()) {
      setPersonResults([]);
      return;
    }
    const result = await searchPeople(personQuery);
    setPersonResults(result.people);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setFieldErrors({});

    if (!selectedPerson) {
      setFieldErrors({ personId: 'Select an existing person.' });
      return;
    }

    const identifierProvided = identifierTypeId || identifierIssuer || identifierValue;

    setSubmitting(true);
    try {
      const result = await createCase({
        requestId: generateRequestId(),
        personId: selectedPerson.personId,
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
      });
      navigate(`/cases/${result.caseId}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && isValidationErrorBody(error.body)) {
        setFieldErrors(error.body.fieldErrors);
      } else {
        setSubmitError('Failed to create case.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) {
    return null;
  }
  if (!user) {
    return <Alert type="info">Sign in to create a case.</Alert>;
  }
  if (loadError) {
    return <Alert type="error">{loadError}</Alert>;
  }
  if (!referenceData) {
    return <p>Loading form…</p>;
  }

  return (
    <Form onSubmit={(event) => void handleSubmit(event)}>
      <Fieldset legend="Client" legendStyle="large">
        <FormGroup error={Boolean(fieldErrors.personId)}>
          <Label htmlFor="personQuery">Search for an existing person</Label>
          {fieldErrors.personId && <ErrorMessage>{fieldErrors.personId}</ErrorMessage>}
          <TextInput
            id="personQuery"
            name="personQuery"
            type="text"
            value={personQuery}
            onChange={(event) => setPersonQuery(event.target.value)}
          />
          <Button type="button" onClick={() => void handlePersonSearch()}>
            Search
          </Button>
          {selectedPerson && (
            <p>
              Selected: <strong>{selectedPerson.displayName}</strong>{' '}
              <Button type="button" unstyled onClick={() => setSelectedPerson(null)}>
                Clear
              </Button>
            </p>
          )}
          {!selectedPerson && personResults.length > 0 && (
            <ul className="usa-list usa-list--unstyled">
              {personResults.map((personResult) => (
                <li key={personResult.personId}>
                  <Button
                    type="button"
                    unstyled
                    onClick={() => {
                      setSelectedPerson(personResult);
                      setPersonResults([]);
                    }}
                  >
                    {personResult.displayName}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </FormGroup>
      </Fieldset>

      <Fieldset legend="Case opening" legendStyle="large">
        <FormGroup error={Boolean(fieldErrors.participantRoleId)}>
          <Label htmlFor="participantRoleId">Participant role</Label>
          {fieldErrors.participantRoleId && <ErrorMessage>{fieldErrors.participantRoleId}</ErrorMessage>}
          <Select
            id="participantRoleId"
            name="participantRoleId"
            value={participantRoleId}
            onChange={(event) => setParticipantRoleId(event.target.value)}
          >
            <option value="">Select a role</option>
            {referenceData.participantRoles.map((option) => (
              <option key={option.roleId} value={option.roleId}>
                {option.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup error={Boolean(fieldErrors.statusId)}>
          <Label htmlFor="statusId">Opening status</Label>
          {fieldErrors.statusId && <ErrorMessage>{fieldErrors.statusId}</ErrorMessage>}
          <Select
            id="statusId"
            name="statusId"
            value={statusId}
            onChange={(event) => setStatusId(event.target.value)}
          >
            <option value="">Select a status</option>
            {referenceData.caseStatuses.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>

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

      <Fieldset legend="Optional context" legendStyle="large">
        <FormGroup>
          <Label htmlFor="countyId">County</Label>
          <Select id="countyId" name="countyId" value={countyId} onChange={(event) => setCountyId(event.target.value)}>
            <option value="">None</option>
            {referenceData.counties.map((option) => (
              <option key={option.countyId} value={option.countyId}>
                {option.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="caseCategoryId">Case category</Label>
          <Select
            id="caseCategoryId"
            name="caseCategoryId"
            value={caseCategoryId}
            onChange={(event) => setCaseCategoryId(event.target.value)}
          >
            <option value="">None</option>
            {referenceData.caseCategories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="organizationId">Organization</Label>
          <Select
            id="organizationId"
            name="organizationId"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          >
            <option value="">None</option>
            {referenceData.organizations.map((option) => (
              <option key={option.organizationId} value={option.organizationId}>
                {option.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="officeId">Office</Label>
          <Select id="officeId" name="officeId" value={officeId} onChange={(event) => setOfficeId(event.target.value)}>
            <option value="">None</option>
            {referenceData.offices.map((option) => (
              <option key={option.officeId} value={option.officeId}>
                {option.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="jurisdictionId">Jurisdiction</Label>
          <Select
            id="jurisdictionId"
            name="jurisdictionId"
            value={jurisdictionId}
            onChange={(event) => setJurisdictionId(event.target.value)}
          >
            <option value="">None</option>
            {referenceData.jurisdictions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="preferredLanguageId">Preferred language</Label>
          <Select
            id="preferredLanguageId"
            name="preferredLanguageId"
            value={preferredLanguageId}
            onChange={(event) => setPreferredLanguageId(event.target.value)}
          >
            <option value="">None</option>
            {referenceData.languages.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>
      </Fieldset>

      <Fieldset legend="Case identifier (optional)" legendStyle="large">
        <FormGroup error={Boolean(fieldErrors.identifier || fieldErrors['identifier.identifierTypeId'])}>
          <Label htmlFor="identifierTypeId">Identifier type</Label>
          {(fieldErrors.identifier || fieldErrors['identifier.identifierTypeId']) && (
            <ErrorMessage>{fieldErrors.identifier ?? fieldErrors['identifier.identifierTypeId']}</ErrorMessage>
          )}
          <Select
            id="identifierTypeId"
            name="identifierTypeId"
            value={identifierTypeId}
            onChange={(event) => setIdentifierTypeId(event.target.value)}
          >
            <option value="">None</option>
            {referenceData.caseIdentifierTypes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.displayName}
              </option>
            ))}
          </Select>
        </FormGroup>
        <FormGroup>
          <Label htmlFor="identifierIssuer">Issuer</Label>
          <TextInput
            id="identifierIssuer"
            name="identifierIssuer"
            type="text"
            value={identifierIssuer}
            onChange={(event) => setIdentifierIssuer(event.target.value)}
          />
        </FormGroup>
        <FormGroup>
          <Label htmlFor="identifierValue">Value</Label>
          <TextInput
            id="identifierValue"
            name="identifierValue"
            type="text"
            value={identifierValue}
            onChange={(event) => setIdentifierValue(event.target.value)}
          />
        </FormGroup>
        <Checkbox
          id="identifierIsPrimary"
          name="identifierIsPrimary"
          label="Primary identifier"
          checked={identifierIsPrimary}
          onChange={(event) => setIdentifierIsPrimary(event.target.checked)}
        />
      </Fieldset>

      {submitError && <Alert type="error">{submitError}</Alert>}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create case'}
      </Button>
    </Form>
  );
}

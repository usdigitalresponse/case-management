import { useEffect, useState, type FormEvent } from 'react';
import { Form, Select } from '@trussworks/react-uswds';
import { apiErrorMessage, discardCaseSplitRead, invoiceTemplateUrl, startCaseSplit, uploadInvoiceFile, type BillableProfessional, type CaseSplitPreview, type MyCasesResult } from '../../api/client';
import { RecordTable } from '../../components/RecordTable';
import { caseChoiceGroups, parseChoice, suggestChoice, type ParsedChoice } from '../bulkImport';
import { DropZone } from '../../components/upload/UploadFiles';
import { Button } from '../../components/ui/Button';
import type { StagedFile } from './stagedFile';
import { SplitAssignment, SplitReadProgress } from './SplitAssignment';

export function StagedFiles({
  cases,
  noCase,
  onStagedCount,
  onUploading,
  onUploaded,
}: {
  cases: MyCasesResult;
  // Staff only: whom a file with no case yet may be from.
  noCase: BillableProfessional[];
  // Files chosen but not yet uploaded, for the step header.
  onStagedCount: (count: number) => void;
  // Cancel waits while files are uploading, so none are left untracked.
  onUploading: (uploading: boolean) => void;
  onUploaded: (importIds: string[]) => void;
}) {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [splitsCreating, setSplitsCreating] = useState(0);
  const groups = caseChoiceGroups(cases, noCase);
  // Staff may upload a file with nothing chosen: no case or professional yet.
  const blankUploads = noCase.length > 0;
  const choiceOf = (row: StagedFile): ParsedChoice | undefined =>
    parseChoice(row.choice) ?? (blankUploads ? { kind: 'no_case' } : undefined);
  useEffect(() => onStagedCount(staged.length), [staged.length, onStagedCount]);
  useEffect(() => onUploading(uploading || splitsCreating > 0), [uploading, splitsCreating, onUploading]);

  function add(files: File[]) {
    const added = files.map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      file,
      choice: suggestChoice(file.name, cases) ?? '',
    }));
    setStaged((current) => [...current, ...added]);
  }

  function update(key: string, changes: Partial<StagedFile>) {
    setStaged((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  // One at a time, so each file's result is clear. A one-person file is
  // only read here, on the server in the background; its drafts are made
  // once its lines have cases.
  async function uploadAll(event: FormEvent) {
    event.preventDefault();
    setUploading(true);
    for (const row of staged) {
      const choice = choiceOf(row);
      if (!choice || row.splitReadId) {
        continue;
      }
      update(row.key, { uploading: true, error: undefined });
      try {
        if (choice.kind === 'case' || choice.kind === 'no_case') {
          // eslint-disable-next-line no-await-in-loop
          const { invoiceImportId } = await uploadInvoiceFile(
            choice.kind === 'case' ? choice.caseId : null,
            row.file,
            choice.professionalId,
          );
          setStaged((current) => current.filter((candidate) => candidate.key !== row.key));
          onUploaded([invoiceImportId]);
        } else {
          // eslint-disable-next-line no-await-in-loop
          const { splitReadId } = await startCaseSplit(row.file, choice.professionalId);
          update(row.key, { uploading: false, splitReadId });
        }
      } catch (err) {
        update(row.key, { uploading: false, error: apiErrorMessage(err, 'The file could not be uploaded.') });
      }
    }
    setUploading(false);
  }

  const ready = staged.filter((row) => choiceOf(row) && !row.splitReadId).length;
  const splitting = staged.filter((row): row is StagedFile & { split: CaseSplitPreview; splitReadId: string } =>
    Boolean(row.split && row.splitReadId),
  );

  // Stops the server reading a one-person file, or forgets its reading.
  function dropSplit(row: StagedFile) {
    if (row.splitReadId) {
      void discardCaseSplitRead(row.splitReadId).catch(() => undefined);
    }
    update(row.key, { splitReadId: undefined, split: undefined });
  }

  return (
    <Form className="compact-form card compact-card" onSubmit={(event) => void uploadAll(event)}>
      <h2>1. Add files</h2>
      <DropZone hasFiles={staged.length > 0} onFiles={add} />
      <p className="compact-hint">
        Using a spreadsheet? Start from the template (<a href={invoiceTemplateUrl('xlsx')} download>XLSX</a> ·{' '}
        <a href={invoiceTemplateUrl('csv')} download>CSV</a>) so every column is read correctly. Then choose each file's case.
      </p>
      <ul className="compact-hint">
        <li>One person's spreadsheet covering several cases: choose "split by case".</li>
        {blankUploads && <li>Case or provider not known yet: leave it blank and match it later on Intake.</li>}
      </ul>
      {staged.length > 0 && (
        <>
          <RecordTable
            rows={staged}
            rowKey={(row) => row.key}
            emptyMessage=""
            columns={[
              { header: 'File', render: (row) => row.file.name },
              {
                header: 'Case',
                render: (row) => (
                  <>
                    <Select
                      id={`bulk-case-${row.key}`}
                      name={`bulk-case-${row.key}`}
                      aria-label={`Case for ${row.file.name}`}
                      value={row.choice}
                      disabled={row.uploading || Boolean(row.splitReadId)}
                      onChange={(event) => update(row.key, { choice: event.target.value, error: undefined })}
                    >
                      <option value="">{blankUploads ? 'No case or provider yet' : '- Choose a case -'}</option>
                      {groups.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.choices.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                    {row.error && <span className="line-row-error">{row.error}</span>}
                  </>
                ),
              },
              {
                header: '',
                render: (row) =>
                  row.uploading ? (
                    <span role="status">Uploading…</span>
                  ) : row.split ? (
                    <span>Assign cases below</span>
                  ) : row.splitReadId ? (
                    <span className="row-actions">
                      <SplitReadProgress
                        splitReadId={row.splitReadId}
                        onReady={(split) => update(row.key, { split })}
                        onFailed={(message) => update(row.key, { splitReadId: undefined, error: message })}
                      />
                      <button type="button" className="link-button" onClick={() => dropSplit(row)}>
                        Stop
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setStaged((current) => current.filter((candidate) => candidate.key !== row.key))}
                    >
                      Remove
                    </button>
                  ),
              },
            ]}
          />
          <div className="invoice-actions">
            <Button type="submit" kind="primary" disabled={uploading || ready === 0}>
              {uploading ? 'Uploading…' : `Upload ${ready} ${ready === 1 ? 'file' : 'files'}`}
            </Button>
            {staged.some((row) => !choiceOf(row)) && !uploading && (
              <span className="compact-hint">Choose a case for each file to upload it.</span>
            )}
          </div>
        </>
      )}
      {splitting.map((row) => {
        const choice = parseChoice(row.choice);
        const person = cases.professionals.find((professional) => professional.professionalId === choice?.professionalId);
        return (
          choice && (
            <SplitAssignment
              key={row.key}
              staged={row}
              whose={person?.isSelf ? 'your' : `${person?.displayName ?? 'this person'}'s`}
              onBusy={(busy) => setSplitsCreating((n) => n + (busy ? 1 : -1))}
              onCreated={(importIds) => {
                setStaged((current) => current.filter((candidate) => candidate.key !== row.key));
                onUploaded(importIds);
              }}
              onCancel={() => dropSplit(row)}
            />
          )
        );
      })}
    </Form>
  );
}

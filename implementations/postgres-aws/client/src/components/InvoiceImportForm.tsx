import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Form, Label } from '@trussworks/react-uswds';
import { apiErrorMessage, invoiceTemplateUrl, uploadInvoiceFile } from '../api/client';

export function InvoiceImportForm({ caseId, professionalId }: { caseId: string; professionalId: string }) {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const result = await uploadInvoiceFile(caseId, file, professionalId || undefined);
      navigate(`/portal/imports/${result.invoiceImportId}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'The file could not be uploaded.'));
      setUploading(false);
    }
  }

  return (
    <Form className="compact-form" onSubmit={(event) => void handleSubmit(event)}>
      {error && <Alert type="error" slim>{error}</Alert>}
      <div className="inline-fields import-fields">
        <div className="usa-form-group">
          <Label htmlFor="invoice-file">Invoice file</Label>
          <input
            id="invoice-file"
            name="invoiceFile"
            type="file"
            className="compact-file"
            accept=".pdf,.txt,.ledes,.csv,.xlsx"
            aria-describedby="invoice-file-hint"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>
        <Button type="submit" disabled={uploading || !file}>
          {uploading ? 'Uploading…' : 'Upload and review'}
        </Button>
      </div>
      <p className="compact-hint" id="invoice-file-hint">
        A PDF invoice, LEDES 1998B, or the invoice template (<a href={invoiceTemplateUrl('xlsx')} download>XLSX</a> ·{' '}
        <a href={invoiceTemplateUrl('csv')} download>CSV</a>), up to 10 MB. You review the items before anything is
        submitted; the file is deleted once you confirm or discard it, or after 3 days.
      </p>
    </Form>
  );
}

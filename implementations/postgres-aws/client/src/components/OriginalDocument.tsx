import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  fileBytes,
  getImportFileBytes,
  getImportPreview,
  getInvoiceFilePreview,
  invoiceFileUrl,
  invoiceImportFileUrl,
  type ImportPreview,
} from '../api/client';
import { useApiResource } from '../hooks/useApiResource';

const PdfPages = lazy(() => import('./PdfPages'));

interface Loaded {
  preview: ImportPreview;
  pdf?: ArrayBuffer;
}

// The uploader reads it through their import; staff through the request.
export type FileSourceRef = { importId: string } | { invoiceId: string };

async function load(source: FileSourceRef): Promise<Loaded> {
  if ('importId' in source) {
    const preview = await getImportPreview(source.importId);
    return preview.kind === 'pdf' ? { preview, pdf: await getImportFileBytes(source.importId) } : { preview };
  }
  const preview = await getInvoiceFilePreview(source.invoiceId);
  return preview.kind === 'pdf' ? { preview, pdf: await fileBytes(invoiceFileUrl(source.invoiceId)) } : { preview };
}

const downloadUrl = (source: FileSourceRef) =>
  'importId' in source ? invoiceImportFileUrl(source.importId) : invoiceFileUrl(source.invoiceId);

// Where a line was read: "page 2, …" or "row 4".
function parseLocation(location: string | undefined): { page?: number; row?: number } {
  if (!location) return {};
  const page = /^page (\d+)/.exec(location)?.[1];
  const row = /row (\d+)/.exec(location)?.[1];
  return { page: page ? Number(page) : undefined, row: row && !page ? Number(row) : undefined };
}

// The uploaded file beside its lines: PDF pages, text or a table. `focus`
// is the location of the line in view; its page scrolls into view, or its
// spreadsheet row is highlighted.
export function OriginalDocument({
  fileName,
  heading = 'Original file',
  focus,
  ...rest
}: {
  fileName: string;
  heading?: string;
  focus?: string;
} & ({ importId: string } | { invoiceId: string })) {
  const source: FileSourceRef = 'importId' in rest ? { importId: rest.importId } : { invoiceId: rest.invoiceId };
  const key = 'importId' in source ? source.importId : source.invoiceId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { data, error } = useApiResource(() => load(source), [key]);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const { page, row } = parseLocation(focus);

  useEffect(() => {
    const element = frame.current;
    if (!element) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = page
      ? document.getElementById(`original-page-${page}`)
      : row
        ? frame.current?.querySelector(`[data-row="${row}"]`)
        : null;
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [page, row, data]);

  return (
    <section className="original-document" aria-label={`${heading}: ${fileName}`}>
      <div className="original-document__bar">
        <div className="original-document__name">
          <h2>{heading}</h2>
          <span>{fileName}</span>
        </div>
        <a href={downloadUrl(source)} download>
          Download
        </a>
      </div>
      <div ref={frame} className="original-document__frame" tabIndex={0}>
        {Boolean(error) && <p className="usa-error-message">The file couldn't be shown; download it instead.</p>}
        {!data && !error && <p role="status">Loading the file…</p>}
        {data?.preview.kind === 'pdf' && data.pdf && width > 0 && (
          <Suspense fallback={<p role="status">Loading the file…</p>}>
            <PdfPages data={data.pdf} width={width} />
          </Suspense>
        )}
        {data?.preview.kind === 'text' && <pre className="original-text">{data.preview.text}</pre>}
        {data?.preview.kind === 'rows' && (
          <table className="original-rows">
            <tbody>
              {data.preview.rows.map((cells, rowIndex) => (
                <tr key={rowIndex} data-row={rowIndex + 1} className={row === rowIndex + 1 ? 'original-rows__focus' : undefined}>
                  <th scope="row">{rowIndex + 1}</th>
                  {cells.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data?.preview.kind !== 'pdf' && data?.preview.truncated && (
          <p className="compact-hint">Only the start of the file is shown; download it to see the rest.</p>
        )}
      </div>
    </section>
  );
}

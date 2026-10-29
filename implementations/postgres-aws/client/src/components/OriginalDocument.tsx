import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  type SourceRegion,
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

// The uploader reads it through their import, before it's an invoice;
// afterwards it's read through the invoice, in the portal or by staff.
export type FileSourceRef = { importId: string } | { invoiceId: string; portal?: boolean };

async function load(source: FileSourceRef): Promise<Loaded> {
  if ('importId' in source) {
    const preview = await getImportPreview(source.importId);
    return preview.kind === 'pdf' ? { preview, pdf: await getImportFileBytes(source.importId) } : { preview };
  }
  const preview = await getInvoiceFilePreview(source.invoiceId, source.portal);
  return preview.kind === 'pdf' ? { preview, pdf: await fileBytes(invoiceFileUrl(source.invoiceId, source.portal)) } : { preview };
}

const downloadUrl = (source: FileSourceRef) =>
  'importId' in source ? invoiceImportFileUrl(source.importId) : invoiceFileUrl(source.invoiceId, source.portal);

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

// Where a line was read: "page 2, …" or "row 4".
function parseLocation(location: string | undefined): { page?: number; row?: number } {
  if (!location) return {};
  const page = /^page (\d+)/.exec(location)?.[1];
  const row = /row (\d+)/.exec(location)?.[1];
  return { page: page ? Number(page) : undefined, row: row && !page ? Number(row) : undefined };
}

// The uploaded file beside its lines: PDF pages, text or a table. `focus`
// is the location of the line in view: outlined where `regions` has it,
// otherwise its page or spreadsheet row is shown. A new `{ location }`
// object shows it again, for a link clicked twice.
export function OriginalDocument({
  fileName,
  heading = 'Original file',
  focus,
  regions = [],
  ...rest
}: {
  fileName: string;
  heading?: string;
  focus?: string | { location: string };
  regions?: Array<{ location: string; region?: SourceRegion | null }>;
} & FileSourceRef) {
  const source: FileSourceRef = 'importId' in rest ? { importId: rest.importId } : { invoiceId: rest.invoiceId, portal: rest.portal };
  const key = 'importId' in source ? source.importId : source.invoiceId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { data, error } = useApiResource(() => load(source), [key]);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const location = typeof focus === 'string' ? focus : focus?.location;
  const { page, row } = parseLocation(location);
  const region = regions.find((line) => line.location === location)?.region;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const highlight = useMemo(() => (region ? { ...region } : undefined), [focus, region]);
  const zoomIndex = ZOOM_STEPS.indexOf(zoom);

  // The page nearest the top of the frame, for "Page 1 of 2".
  function trackPage() {
    const element = frame.current;
    if (!element) return;
    const pages = [...element.querySelectorAll<HTMLElement>('.original-page')];
    const line = element.scrollTop + element.clientHeight / 3;
    const showing = pages.filter((canvas) => canvas.offsetTop <= line).at(-1);
    setCurrentPage(Number(showing?.dataset.page ?? 1));
  }

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
    if (highlight) {
      return;
    }
    const target = page
      ? document.getElementById(`original-page-${page}`)
      : row
        ? frame.current?.querySelector(`[data-row="${row}"]`)
        : null;
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [page, row, data, highlight, focus]);

  return (
    <section className="original-document" aria-label={`${heading}: ${fileName}`}>
      <div className="original-document__bar">
        <div className="original-document__name">
          <h2>{heading}</h2>
          <span>{fileName}</span>
        </div>
        <div className="original-document__tools">
          {pageCount > 1 && (
            <span className="original-document__page" aria-live="polite">
              Page {currentPage} of {pageCount}
            </span>
          )}
          {data && (
            <span className="zoom-controls" role="group" aria-label="Zoom">
              <button
                type="button"
                className="zoom-controls__step"
                aria-label="Zoom out"
                disabled={zoomIndex <= 0}
                onClick={() => setZoom(ZOOM_STEPS[zoomIndex - 1] ?? zoom)}
              >
                −
              </button>
              <button
                type="button"
                className="zoom-controls__level"
                title="Fit to width"
                aria-label={`Zoom ${Math.round(zoom * 100)}%. Fit to width`}
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="zoom-controls__step"
                aria-label="Zoom in"
                disabled={zoomIndex >= ZOOM_STEPS.length - 1}
                onClick={() => setZoom(ZOOM_STEPS[zoomIndex + 1] ?? zoom)}
              >
                +
              </button>
            </span>
          )}
          <a href={downloadUrl(source)} download>
            Download
          </a>
        </div>
      </div>
      <div ref={frame} className="original-document__frame" tabIndex={0} onScroll={trackPage}>
        {Boolean(error) && <p className="usa-error-message">The file couldn't be shown; download it instead.</p>}
        {!data && !error && <p role="status">Loading the file…</p>}
        {data?.preview.kind === 'pdf' && data.pdf && width > 0 && (
          <Suspense fallback={<p role="status">Loading the file…</p>}>
            <PdfPages data={data.pdf} width={Math.round(width * zoom)} highlight={highlight} onPageCount={setPageCount} />
          </Suspense>
        )}
        {data?.preview.kind === 'text' && (
          <pre className="original-text" style={{ fontSize: `${0.78 * zoom}rem` }}>
            {data.preview.text}
          </pre>
        )}
        {data?.preview.kind === 'rows' && (
          <table className="original-rows" style={{ fontSize: `${0.8 * zoom}rem` }}>
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

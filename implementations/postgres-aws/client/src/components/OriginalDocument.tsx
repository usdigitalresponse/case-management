import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { getImportFileBytes, getImportPreview, invoiceImportFileUrl, type ImportPreview } from '../api/client';
import { useApiResource } from '../hooks/useApiResource';

const PdfPages = lazy(() => import('./PdfPages'));

interface Loaded {
  preview: ImportPreview;
  pdf?: ArrayBuffer;
}

async function load(importId: string): Promise<Loaded> {
  const preview = await getImportPreview(importId);
  return preview.kind === 'pdf' ? { preview, pdf: await getImportFileBytes(importId) } : { preview };
}

// The uploaded file beside import review: PDF pages, text or a table.
export function OriginalDocument({ importId, fileName }: { importId: string; fileName: string }) {
  const { data, error } = useApiResource(() => load(importId), [importId]);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = frame.current;
    if (!element) {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="original-document" aria-label={`Original file: ${fileName}`}>
      <div className="original-document__bar">
        <h2>Original file</h2>
        <a href={invoiceImportFileUrl(importId)} download>
          Download {fileName}
        </a>
      </div>
      <div ref={frame} className="original-document__frame" tabIndex={0}>
        {Boolean(error) && <p className="usa-error-message">The original file couldn't be shown; download it instead.</p>}
        {!data && !error && <p role="status">Loading the original…</p>}
        {data?.preview.kind === 'pdf' && data.pdf && width > 0 && (
          <Suspense fallback={<p role="status">Loading the original…</p>}>
            <PdfPages data={data.pdf} width={width} />
          </Suspense>
        )}
        {data?.preview.kind === 'text' && <pre className="original-text">{data.preview.text}</pre>}
        {data?.preview.kind === 'rows' && (
          <table className="original-rows">
            <tbody>
              {data.preview.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th scope="row">{rowIndex + 1}</th>
                  {row.map((cell, cellIndex) => (
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

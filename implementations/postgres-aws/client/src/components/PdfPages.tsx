import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

// Draws PDF pages onto canvases with PDF.js, so uploaded content never opens
// as a page; PDF.js's core runs no document scripts. Loaded lazily. The
// document is read once; zooming only redraws the pages at the new width,
// so they stay sharp.
export default function PdfPages({
  data,
  width,
  onPageCount,
}: {
  data: ArrayBuffer;
  width: number;
  onPageCount?: (count: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ data: new Uint8Array(data.slice(0)) });
    task.promise.then(
      (loaded) => {
        if (!cancelled) {
          setPdf(loaded);
          onPageCount?.(loaded.numPages);
        }
      },
      () => {
        if (!cancelled) setError(true);
      },
    );
    return () => {
      cancelled = true;
      setPdf(null);
      void task.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    const target = container.current;
    if (!pdf || !target) {
      return undefined;
    }
    let cancelled = false;
    target.replaceChildren();
    (async () => {
      for (let number = 1; number <= pdf.numPages && !cancelled; number += 1) {
        // eslint-disable-next-line no-await-in-loop
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const scale = width / viewport.width;
        const scaled = page.getViewport({ scale: scale * window.devicePixelRatio });
        const canvas = document.createElement('canvas');
        canvas.id = `original-page-${number}`;
        canvas.className = 'original-page';
        canvas.dataset.page = String(number);
        canvas.width = scaled.width;
        canvas.height = scaled.height;
        canvas.style.width = `${width}px`;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Original document, page ${number} of ${pdf.numPages}`);
        if (cancelled) return;
        target.append(canvas);
        // eslint-disable-next-line no-await-in-loop
        await page.render({ canvas, viewport: scaled }).promise;
      }
    })().catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, width]);

  return (
    <>
      {error && <p className="usa-error-message">The PDF couldn't be shown; download it instead.</p>}
      <div ref={container} className="original-pages" />
    </>
  );
}

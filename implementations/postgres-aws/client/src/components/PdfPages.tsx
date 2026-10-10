import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

// Draws PDF pages onto canvases with PDF.js, so uploaded content never opens
// as a page; PDF.js's core runs no document scripts. Loaded lazily.
export default function PdfPages({ data, width }: { data: ArrayBuffer; width: number }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const target = container.current;
    if (!target) {
      return undefined;
    }
    target.replaceChildren();
    const task = getDocument({ data: new Uint8Array(data.slice(0)) });
    (async () => {
      const pdf = await task.promise;
      for (let number = 1; number <= pdf.numPages && !cancelled; number += 1) {
        // eslint-disable-next-line no-await-in-loop
        const page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const scale = width / viewport.width;
        const scaled = page.getViewport({ scale: scale * window.devicePixelRatio });
        const canvas = document.createElement('canvas');
        canvas.id = `original-page-${number}`;
        canvas.className = 'original-page';
        canvas.width = scaled.width;
        canvas.height = scaled.height;
        canvas.style.width = `${width}px`;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Original document, page ${number} of ${pdf.numPages}`);
        target.append(canvas);
        // eslint-disable-next-line no-await-in-loop
        await page.render({ canvas, viewport: scaled }).promise;
      }
    })().catch(() => {
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [data, width]);

  return (
    <>
      {error && <p className="usa-error-message">The PDF couldn't be shown; download it instead.</p>}
      <div ref={container} className="original-pages" />
    </>
  );
}

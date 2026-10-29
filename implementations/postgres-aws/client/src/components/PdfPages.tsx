import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceRegion } from '../api/client';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

// Draws PDF pages onto canvases with PDF.js, so uploaded content never opens
// as a page; PDF.js's core runs no document scripts. Loaded lazily. The
// document is read once; zooming only redraws the pages at the new width,
// so they stay sharp.
export default function PdfPages({
  data,
  width,
  highlight,
  onPageCount,
}: {
  data: ArrayBuffer;
  width: number;
  highlight?: SourceRegion;
  onPageCount?: (count: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  // A highlight whose page wasn't drawn yet is scrolled to once it is.
  const scrollPending = useRef(false);
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
        const frame = document.createElement('div');
        frame.id = `original-page-${number}`;
        frame.className = 'original-page';
        frame.dataset.page = String(number);
        const canvas = document.createElement('canvas');
        canvas.width = scaled.width;
        canvas.height = scaled.height;
        canvas.style.width = `${width}px`;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Original document, page ${number} of ${pdf.numPages}`);
        if (cancelled) return;
        frame.append(canvas);
        target.append(frame);
        if (placeHighlight(target, highlightRef.current, scrollPending.current)) {
          scrollPending.current = false;
        }
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

  // Redrawn pages place it without scrolling; this moves it to a new line.
  useEffect(() => {
    if (container.current) {
      scrollPending.current = Boolean(highlight) && !placeHighlight(container.current, highlight, true);
    }
  }, [highlight]);

  return (
    <>
      {error && <p className="usa-error-message">The PDF couldn't be shown; download it instead.</p>}
      <div ref={container} className="original-pages" />
    </>
  );
}

// Whether its page is drawn. Only the viewer's frame scrolls, not the page.
function placeHighlight(container: HTMLElement, region: SourceRegion | undefined, scroll: boolean): boolean {
  container.querySelector('.original-highlight')?.remove();
  const page = region && container.querySelector<HTMLElement>(`#original-page-${region.page}`);
  if (!region || !page) {
    return false;
  }
  const mark = document.createElement('div');
  mark.className = 'original-highlight';
  // Fractions of the page, so it stays put at any zoom.
  mark.style.left = `${region.left * 100}%`;
  mark.style.top = `${region.top * 100}%`;
  mark.style.width = `${region.width * 100}%`;
  mark.style.height = `${region.height * 100}%`;
  page.append(mark);
  const frame = container.closest<HTMLElement>('.original-document__frame');
  if (scroll && frame) {
    const [box, view] = [mark.getBoundingClientRect(), frame.getBoundingClientRect()];
    frame.scrollBy({
      top: box.top - view.top - (frame.clientHeight - box.height) / 2,
      left: box.left - view.left - (frame.clientWidth - box.width) / 2,
      behavior: 'smooth',
    });
  }
  return true;
}

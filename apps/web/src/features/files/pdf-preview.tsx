'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { messageOf } from '@/lib/api/client.ts';

export function PdfPreview({
  name,
  downloadPath,
}: {
  readonly name: string;
  readonly downloadPath: string;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [rendered, setRendered] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    let dispose = () => Promise.resolve();
    async function load() {
      const pdf = await import('pdfjs-dist');
      if (cancelled) return;
      pdf.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      const task = pdf.getDocument({
        url: `${downloadPath}?preview=true`,
        enableXfa: false,
      });
      dispose = () => task.destroy();
      const loaded = await task.promise;
      if (!cancelled) setDocument(loaded);
    }
    load().catch((failure: unknown) => {
      if (!cancelled)
        setError(messageOf(failure, 'This PDF could not be previewed. Download it to open it.'));
    });
    return () => {
      cancelled = true;
      dispose().catch((failure: unknown) =>
        console.error('Could not release PDF preview.', failure),
      );
    };
  }, [downloadPath]);
  useEffect(() => {
    if (document === null) return;
    let cancelled = false;
    let cancelRender: (() => void) | null = null;
    setRendered(false);
    async function render() {
      if (document === null) return;
      const target = canvas.current;
      if (target === null) return;
      const pdfPage = await document.getPage(page);
      if (cancelled) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const width = Math.min(target.parentElement?.clientWidth ?? 640, 800);
      const ratio = Math.min(window.devicePixelRatio, 2);
      const viewport = pdfPage.getViewport({ scale: (width / natural.width) * ratio });
      target.width = Math.floor(viewport.width);
      target.height = Math.floor(viewport.height);
      const task = pdfPage.render({ canvas: target, viewport });
      cancelRender = () => task.cancel();
      await task.promise;
      const content = await pdfPage.getTextContent();
      if (!cancelled) {
        setText(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
        setRendered(true);
      }
    }
    render().catch((failure: unknown) => {
      if (!cancelled) setError(messageOf(failure, 'This page could not be rendered.'));
    });
    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [document, page]);
  return (
    <section aria-label={`PDF preview of ${name}`} className="flex flex-col gap-3">
      {error === null ? null : (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {error === null && !rendered ? (
        <p role="status" className="text-muted">
          Rendering PDF…
        </p>
      ) : null}
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-surface-2">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${name}, page ${page}`}
          data-rendered={rendered}
          className="mx-auto h-auto max-w-full"
        />
      </div>
      {document === null ? null : (
        <div className="flex items-center justify-between gap-3">
          <Button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            Previous page
          </Button>
          <p className="text-muted text-sm" aria-live="polite">
            Page {page} of {document.numPages}
          </p>
          <Button
            disabled={page >= document.numPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next page
          </Button>
        </div>
      )}
      {rendered ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Page text</summary>
          <p className="mt-2 whitespace-pre-wrap text-text">{text}</p>
        </details>
      ) : null}
    </section>
  );
}

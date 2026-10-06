'use client';

import type { PptxViewer } from '@aiden0z/pptx-renderer';
import type { FileEntry } from '@gravity/shared/validators';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { messageOf } from '@/lib/api/client.ts';
import { DocumentFrame } from './document-frame.tsx';
import { localOfficeArchive } from './office-archive.ts';
import { usePreviewBytes } from './use-preview-bytes.ts';

function WordPreview({ data, name }: { readonly data: ArrayBuffer; readonly name: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function render() {
      const [docx, bytes] = await Promise.all([import('docx-preview'), localOfficeArchive(data)]);
      const container = document.createElement('div');
      await docx.renderAsync(bytes, container, undefined, {
        useBase64URL: true,
        renderAltChunks: false,
        renderComments: false,
        ignoreFonts: true,
      });
      if (!cancelled) setHtml(container.innerHTML);
    }
    render().catch((failure: unknown) => {
      if (!cancelled) setError(messageOf(failure));
    });
    return () => {
      cancelled = true;
    };
  }, [data]);
  if (error !== null)
    return (
      <p role="alert" className="text-danger">
        {error}
      </p>
    );
  return html === null ? (
    <p role="status" className="text-muted">
      Rendering document…
    </p>
  ) : (
    <DocumentFrame name={name} html={html} />
  );
}

function SlidesPreview({ data, name }: { readonly data: ArrayBuffer; readonly name: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const viewer = useRef<PptxViewer | null>(null);
  const container = useRef<HTMLElement | null>(null);
  const preview = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [pptx, bytes] = await Promise.all([
        import('@aiden0z/pptx-renderer'),
        localOfficeArchive(data),
      ]);
      if (cancelled) return;
      const host = document.createElement('div');
      const width = Math.max(240, Math.min(960, preview.current?.clientWidth ?? 960));
      host.style.width = `${width}px`;
      container.current = host;
      const instance = await pptx.PptxViewer.open(bytes, host, {
        width,
        renderMode: 'slide',
        pdfjs: false,
        zipLimits: pptx.RECOMMENDED_ZIP_LIMITS,
      });
      if (cancelled) {
        instance.destroy();
        return;
      }
      viewer.current = instance;
      setCount(instance.slideCount);
      setHtml(host.innerHTML);
    }
    load().catch((failure: unknown) => {
      if (!cancelled) setError(messageOf(failure));
    });
    return () => {
      cancelled = true;
      viewer.current?.destroy();
      viewer.current = null;
    };
  }, [data]);
  async function navigate(next: number) {
    try {
      await viewer.current?.renderSlide(next);
      setPage(next);
      setHtml(container.current?.innerHTML ?? '');
    } catch (failure: unknown) {
      setError(messageOf(failure));
    }
  }
  return (
    <section ref={preview} aria-label="Presentation preview" className="flex flex-col gap-3">
      {error === null ? null : (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {html === null ? (
        <p role="status" className="text-muted">
          Rendering slides…
        </p>
      ) : (
        <DocumentFrame name={name} html={html} />
      )}
      {count === 0 ? null : (
        <div className="flex items-center justify-between">
          <Button disabled={page === 0} onClick={() => navigate(page - 1)}>
            Previous slide
          </Button>
          <p className="text-muted text-sm" aria-live="polite">
            Slide {page + 1} of {count}
          </p>
          <Button disabled={page >= count - 1} onClick={() => navigate(page + 1)}>
            Next slide
          </Button>
        </div>
      )}
    </section>
  );
}

export function OfficePreview({
  entry,
  downloadPath,
}: {
  readonly entry: FileEntry;
  readonly downloadPath: string;
}) {
  const query = usePreviewBytes(entry, downloadPath);
  if (query.error !== null)
    return (
      <p role="alert" className="text-danger">
        {messageOf(query.error)}
      </p>
    );
  if (query.isPending)
    return (
      <p role="status" className="text-muted">
        Opening document…
      </p>
    );
  return entry.name.toLowerCase().endsWith('.pptx') ? (
    <SlidesPreview data={query.data} name={entry.name} />
  ) : (
    <WordPreview data={query.data} name={entry.name} />
  );
}

'use client';

import type { PptxViewer, SlideHandle } from '@aiden0z/pptx-renderer';
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
  const slide = useRef<SlideHandle | null>(null);
  const [slideSize, setSlideSize] = useState<{ width: number; height: number } | undefined>();
  const [navigating, setNavigating] = useState(false);
  const rendering = useRef(false);
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
      if (
        !(Number.isFinite(instance.slideWidth) && Number.isFinite(instance.slideHeight)) ||
        instance.slideWidth <= 0 ||
        instance.slideHeight <= 0 ||
        instance.slideWidth > 100_000 ||
        instance.slideHeight > 100_000
      )
        throw new Error('This presentation has unsupported slide dimensions.');
      setCount(instance.slideCount);
      setSlideSize({ width: instance.slideWidth, height: instance.slideHeight });
      host.replaceChildren();
      const handle = instance.renderSlideToContainer(0, host, 1);
      slide.current = handle;
      await handle?.ready;
      if (cancelled) return;
      setHtml(host.innerHTML);
    }
    load().catch((failure: unknown) => {
      if (!cancelled) setError(messageOf(failure));
    });
    return () => {
      cancelled = true;
      slide.current?.dispose();
      slide.current = null;
      viewer.current?.destroy();
      viewer.current = null;
    };
  }, [data]);
  async function navigate(next: number) {
    const instance = viewer.current;
    const host = container.current;
    if (instance === null || host === null || rendering.current || next < 0 || next >= count)
      return;
    rendering.current = true;
    setNavigating(true);
    try {
      slide.current?.dispose();
      host.replaceChildren();
      const handle = instance.renderSlideToContainer(next, host, 1);
      slide.current = handle;
      await handle?.ready;
      if (viewer.current !== instance) return;
      setPage(next);
      setHtml(host.innerHTML);
    } catch (failure: unknown) {
      setError(messageOf(failure));
    } finally {
      rendering.current = false;
      setNavigating(false);
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
        <DocumentFrame
          name={name}
          html={html}
          {...(slideSize === undefined ? {} : { slideSize })}
        />
      )}
      {count === 0 ? null : (
        <div className="flex items-center justify-between">
          <Button size="sm" disabled={page === 0 || navigating} onClick={() => navigate(page - 1)}>
            Previous slide
          </Button>
          <p className="text-muted text-sm" aria-live="polite">
            Slide {page + 1} of {count}
          </p>
          <Button
            size="sm"
            disabled={page >= count - 1 || navigating}
            onClick={() => navigate(page + 1)}
          >
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
    <SlidesPreview key={`${entry.id}:${entry.syncId}`} data={query.data} name={entry.name} />
  ) : (
    <WordPreview key={`${entry.id}:${entry.syncId}`} data={query.data} name={entry.name} />
  );
}

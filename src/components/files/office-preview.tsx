"use client";

import type { PptxViewer, SlideHandle } from "@aiden0z/pptx-renderer";
import type { FileEntry } from "@crm/files/validators";
import t from "@crm/i18n/translations/en.json";
import { useEffect, useRef, useState } from "react";
import { DocumentFrame } from "./document-frame";
import { localOfficeArchive } from "./office-archive";
import { Button, messageOf } from "./preview-controls";
import { usePreviewBytes } from "./use-preview-bytes";

async function slideHtml(host: HTMLElement): Promise<string> {
  const clone = host.cloneNode(true);
  if (!(clone instanceof HTMLElement))
    throw new Error(t.files.thisSlideCouldNotBePreviewed);
  const resources = new Map<string, Promise<string>>();
  let bytes = 0;
  async function inline(source: string) {
    const pattern = /blob:[^"'()\s<>]+/g;
    for (const url of new Set(source.match(pattern) ?? [])) {
      if (resources.has(url)) continue;
      resources.set(
        url,
        (async () => {
          const response = await fetch(url);
          if (!response.ok)
            throw new Error(t.files.anEmbeddedSlideImageCouldNotBe);
          const blob = await response.blob();
          bytes += blob.size;
          if (bytes > 64 * 1024 * 1024)
            throw new Error(t.files.thisSlideHasTooMuchEmbeddedMedia);
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") resolve(reader.result);
              else reject(new Error(t.files.anEmbeddedSlideImageCouldNotBe2));
            };
            reader.onerror = () =>
              reject(new Error(t.files.anEmbeddedSlideImageCouldNotBe2));
            reader.readAsDataURL(blob);
          });
        })(),
      );
    }
    const resolved = new Map(
      await Promise.all(
        [...new Set(source.match(pattern) ?? [])].map(
          async (url) => [url, await resources.get(url)] as const,
        ),
      ),
    );
    return source.replace(pattern, (url) => resolved.get(url) ?? url);
  }
  await Promise.all(
    [clone, ...clone.querySelectorAll("*")].flatMap((element) => [
      ...[...element.attributes]
        .filter((attribute) =>
          ["src", "href", "xlink:href", "style"].includes(attribute.name),
        )
        .map(async (attribute) => {
          attribute.value = await inline(attribute.value);
        }),
      ...(element.tagName === "STYLE"
        ? [
            (async () => {
              element.textContent = await inline(element.textContent ?? "");
            })(),
          ]
        : []),
    ]),
  );
  return clone.innerHTML;
}

function WordPreview({
  data,
  name,
}: {
  readonly data: ArrayBuffer;
  readonly name: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function render() {
      const [docx, bytes] = await Promise.all([
        import("docx-preview"),
        localOfficeArchive(data),
      ]);
      const container = document.createElement("div");
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
      {t.files.renderingDocument}
    </p>
  ) : (
    <DocumentFrame name={name} html={html} />
  );
}

function SlidesPreview({
  data,
  name,
}: {
  readonly data: ArrayBuffer;
  readonly name: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const viewer = useRef<PptxViewer | null>(null);
  const slide = useRef<SlideHandle | null>(null);
  const [slideSize, setSlideSize] = useState<
    { width: number; height: number } | undefined
  >();
  const [navigating, setNavigating] = useState(false);
  const rendering = useRef(false);
  const container = useRef<HTMLElement | null>(null);
  const preview = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [pptx, bytes] = await Promise.all([
        import("@aiden0z/pptx-renderer"),
        localOfficeArchive(data),
      ]);
      if (cancelled) return;
      const host = document.createElement("div");
      const width = Math.max(
        240,
        Math.min(960, preview.current?.clientWidth ?? 960),
      );
      host.style.width = `${width}px`;
      container.current = host;
      const instance = await pptx.PptxViewer.open(bytes, host, {
        width,
        renderMode: "slide",
        pdfjs: false,
        zipLimits: pptx.RECOMMENDED_ZIP_LIMITS,
      });
      if (cancelled) {
        instance.destroy();
        return;
      }
      viewer.current = instance;
      if (
        !(
          Number.isFinite(instance.slideWidth) &&
          Number.isFinite(instance.slideHeight)
        ) ||
        instance.slideWidth <= 0 ||
        instance.slideHeight <= 0 ||
        instance.slideWidth > 100_000 ||
        instance.slideHeight > 100_000
      )
        throw new Error(t.files.thisPresentationHasUnsupportedSlideDimensions);
      setCount(instance.slideCount);
      setSlideSize({
        width: instance.slideWidth,
        height: instance.slideHeight,
      });
      host.replaceChildren();
      const handle = instance.renderSlideToContainer(0, host, 1);
      slide.current = handle;
      await handle?.ready;
      if (cancelled) return;
      const snapshot = await slideHtml(host);
      if (!cancelled) setHtml(snapshot);
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
    if (
      instance === null ||
      host === null ||
      rendering.current ||
      next < 0 ||
      next >= count
    )
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
      const snapshot = await slideHtml(host);
      if (viewer.current !== instance) return;
      setPage(next);
      setHtml(snapshot);
    } catch (failure: unknown) {
      setError(messageOf(failure));
    } finally {
      rendering.current = false;
      setNavigating(false);
    }
  }
  return (
    <section
      ref={preview}
      aria-label={t.files.presentationPreview}
      className="flex flex-col gap-3"
    >
      {error === null ? null : (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {html === null ? (
        <p role="status" className="text-muted">
          {t.files.renderingSlides}
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
          <Button
            size="sm"
            disabled={page === 0 || navigating}
            onClick={() => navigate(page - 1)}
          >
            {t.files.previousSlide}
          </Button>
          <p className="text-muted text-sm" aria-live="polite">
            {t.files.slideCount
              .replace("{page}", String(page + 1))
              .replace("{count}", String(count))}
          </p>
          <Button
            size="sm"
            disabled={page >= count - 1 || navigating}
            onClick={() => navigate(page + 1)}
          >
            {t.files.nextSlide}
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
        {t.files.openingDocument}
      </p>
    );
  return entry.name.toLowerCase().endsWith(".pptx") ? (
    <SlidesPreview
      key={`${entry.id}:${entry.syncId}`}
      data={query.data}
      name={entry.name}
    />
  ) : (
    <WordPreview
      key={`${entry.id}:${entry.syncId}`}
      data={query.data}
      name={entry.name}
    />
  );
}

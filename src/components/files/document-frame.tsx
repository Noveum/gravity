"use client";

import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";

export function safeDocumentHtml(
  html: string,
  purifier: Pick<typeof DOMPurify, "sanitize"> = DOMPurify,
): string {
  const clean = purifier.sanitize(html, {
    FORCE_BODY: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "meta",
      "link",
      "base",
    ],
    ALLOWED_URI_REGEXP: /^(?:data:(?:image\/|font\/)|blob:|#)/i,
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>html,body{margin:0;min-height:100%;background:white;color:black;font-family:Arial,sans-serif}body{overflow:auto}img{max-width:100%}.docx-wrapper{padding:12px!important;background:transparent!important}.docx-wrapper>section.docx{margin:auto!important;box-shadow:none!important;max-width:100%;box-sizing:border-box}</style></head><body>${clean}</body></html>`;
}

export function DocumentFrame({
  name,
  html,
  slideSize,
}: {
  readonly name: string;
  readonly html: string;
  readonly slideSize?: { readonly width: number; readonly height: number };
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (element === null || slideSize === undefined) return;
    const resize = () => setWidth(element.clientWidth);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [slideSize]);
  const source = useMemo(
    () =>
      safeDocumentHtml(
        slideSize === undefined
          ? html
          : `<style>html,body{overflow:hidden}</style><div style="width:${slideSize.width}px;height:${slideSize.height}px;transform:scale(${width / slideSize.width});transform-origin:top left">${html}</div>`,
      ),
    [html, slideSize, width],
  );
  return (
    <div
      className="mx-auto w-full"
      style={
        slideSize === undefined
          ? undefined
          : {
              width: `min(100%, calc((100dvh - 200px) * ${slideSize.width / slideSize.height}))`,
            }
      }
    >
      <iframe
        ref={frame}
        title={`Preview of ${name}`}
        sandbox=""
        srcDoc={source}
        style={
          slideSize === undefined
            ? undefined
            : { aspectRatio: `${slideSize.width} / ${slideSize.height}` }
        }
        className={
          slideSize === undefined
            ? "h-[65vh] w-full rounded-md border border-border bg-surface"
            : "block w-full rounded-md border border-border bg-surface"
        }
      />
    </div>
  );
}

'use client';

import DOMPurify from 'dompurify';
import { useMemo } from 'react';

export function safeDocumentHtml(
  html: string,
  purifier: Pick<typeof DOMPurify, 'sanitize'> = DOMPurify,
): string {
  const clean = purifier.sanitize(html, {
    FORCE_BODY: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'meta',
      'link',
      'base',
    ],
    ALLOWED_URI_REGEXP: /^(?:data:(?:image\/|font\/)|blob:|#)/i,
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>html,body{margin:0;min-height:100%;background:white;color:black;font-family:Arial,sans-serif}body{overflow:auto}img{max-width:100%}.docx-wrapper{padding:12px!important;background:transparent!important}.docx-wrapper>section.docx{margin:auto!important;box-shadow:none!important;max-width:100%;box-sizing:border-box}</style></head><body>${clean}</body></html>`;
}

export function DocumentFrame({ name, html }: { readonly name: string; readonly html: string }) {
  const source = useMemo(() => safeDocumentHtml(html), [html]);
  return (
    <iframe
      title={`Preview of ${name}`}
      sandbox=""
      srcDoc={source}
      className="h-[65vh] w-full rounded-md border border-border bg-surface"
    />
  );
}

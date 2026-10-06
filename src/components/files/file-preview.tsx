"use client";

import { type FileEntry, previewMimeForFile } from "@crm/files/validators";
import t from "@crm/i18n/translations/en.json";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Image from "next/image";
import { messageOf } from "./preview-controls";

const PdfPreview = dynamic(
  () => import("./pdf-preview").then((module) => module.PdfPreview),
  {
    ssr: false,
  },
);
const OfficePreview = dynamic(
  () => import("./office-preview").then((module) => module.OfficePreview),
  { ssr: false },
);
const SpreadsheetPreview = dynamic(
  () =>
    import("./spreadsheet-preview").then((module) => module.SpreadsheetPreview),
  { ssr: false },
);

function TextPreview({
  name,
  downloadPath,
}: {
  readonly name: string;
  readonly downloadPath: string;
}) {
  const query = useQuery({
    queryKey: ["file-text-preview", downloadPath],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `${downloadPath}${downloadPath.includes("?") ? "&" : "?"}preview=true`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error(t.files.thisPreviewCouldNotBeLoaded);
      return await response.text();
    },
    gcTime: 0,
    staleTime: 0,
  });
  if (query.error !== null)
    return (
      <p role="alert" className="text-danger">
        {messageOf(query.error)}
      </p>
    );
  if (query.isPending)
    return <p className="text-muted">{t.files.loadingPreview}</p>;
  return (
    <section aria-label={t.files.previewOf.replace("{name}", name)}>
      <pre className="max-h-[65vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-4 text-sm text-text">
        {query.data}
      </pre>
    </section>
  );
}

function PreviewContent({
  entry,
  downloadPath,
}: {
  readonly entry: FileEntry;
  readonly downloadPath: string;
}) {
  const mimeType = previewMimeForFile(entry.name, entry.mimeType);
  const extension = entry.name.toLowerCase().split(".").at(-1);
  if (extension === "docx" || extension === "pptx")
    return <OfficePreview entry={entry} downloadPath={downloadPath} />;
  if (extension === "xlsx")
    return <SpreadsheetPreview entry={entry} downloadPath={downloadPath} />;
  if (mimeType === "application/pdf" && entry.size <= 32 * 1024 * 1024)
    return <PdfPreview name={entry.name} downloadPath={downloadPath} />;
  if (mimeType?.startsWith("image/"))
    return (
      <Image
        unoptimized
        width={1200}
        height={800}
        src={`${downloadPath}${downloadPath.includes("?") ? "&" : "?"}preview=true`}
        alt={entry.name}
        className="max-h-[65vh] w-full rounded-lg border border-border object-contain"
      />
    );
  if (
    (mimeType === "text/plain" || mimeType === "text/csv") &&
    entry.size <= 1024 * 1024
  )
    return <TextPreview name={entry.name} downloadPath={downloadPath} />;
  return (
    <p className="py-10 text-center text-muted">
      {entry.size === 0
        ? t.files.thisFileIsEmpty
        : t.files.unsupportedFormat.replace(
            "{format}",
            extension ?? entry.mimeType ?? "binary",
          )}
    </p>
  );
}

export function FilePreview({
  entry,
  downloadPath,
}: {
  readonly entry: FileEntry;
  readonly downloadPath: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PreviewContent entry={entry} downloadPath={downloadPath} />
    </div>
  );
}

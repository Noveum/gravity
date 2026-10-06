"use client";
import type { FileDetail, FileEntry } from "@crm/files/validators";
import t from "@crm/i18n/translations/en.json";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { requestJson } from "../client-api";
import { publicDetailSchema } from "./file-api";
import { FilePreview } from "./file-preview";
import { MarkdownPreview } from "./markdown-preview";
import "./file-library.css";
export function PublicFile({
  token,
  initial,
}: {
  token: string;
  initial: FileDetail & { entries: FileEntry[] };
}) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <Content token={token} initial={initial} />
    </QueryClientProvider>
  );
}
function Content({
  token,
  initial,
}: {
  token: string;
  initial: FileDetail & { entries: FileEntry[] };
}) {
  const query = useQuery({
    queryKey: ["public-file", token],
    queryFn: async ({ signal }) =>
      publicDetailSchema.parse(
        await requestJson(`/api/files?operation=public&token=${token}`, {
          signal,
        }),
      ),
    initialData: initial,
    staleTime: 0,
    refetchInterval: 5000,
    retry: false,
  });
  const download = `/api/files?operation=public-download&token=${token}`;
  return (
    <main className="library-public file-library-page">
      <header className="library-toolbar">
        <h1>{query.data.entry.name}</h1>
        {query.data.entry.kind !== "folder" && !query.error && (
          <a href={download}>{t.download}</a>
        )}
      </header>
      <div className="file-preview">
        {query.error ? (
          <p role="alert">{t.files.publicUnavailable}</p>
        ) : query.data.entry.kind === "folder" ? (
          <ul>
            {query.data.entries
              .filter((entry) => entry.publicToken)
              .map((entry) => (
                <li key={entry.id}>
                  <a href={`/shared/files/${entry.publicToken}`}>
                    {entry.name}
                  </a>
                </li>
              ))}
          </ul>
        ) : query.data.entry.kind === "markdown" ? (
          <MarkdownPreview body={query.data.body ?? ""} />
        ) : (
          <FilePreview entry={query.data.entry} downloadPath={download} />
        )}
      </div>
    </main>
  );
}

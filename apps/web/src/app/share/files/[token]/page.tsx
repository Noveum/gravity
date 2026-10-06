import { getPublicFile } from '@gravity/core';
import { isDomainError } from '@gravity/shared/errors';
import { publicFileTokenSchema } from '@gravity/shared/validators';
import { File, Folder } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button.tsx';
import { FilePreview } from '@/features/files/file-preview.tsx';
import { MarkdownPreview } from '@/features/files/markdown-preview.tsx';

export const dynamic = 'force-dynamic';

async function publicDocument(token: string) {
  if (!publicFileTokenSchema.safeParse(token).success) notFound();
  try {
    return await getPublicFile(token);
  } catch (error: unknown) {
    if (isDomainError(error) && error.code === 'not_found') notFound();
    throw error;
  }
}

export default async function SharedFilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { entry, body, entries } = await publicDocument(token);
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <p className="mb-6 font-medium text-muted text-xs">Gravity · Shared document</p>
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl text-text">{entry.name}</h1>
          <p className="mt-2 text-muted text-xs">Public view access</p>
        </div>
        {entry.kind === 'folder' ? null : (
          <Button asChild>
            <a href={`/api/public/files/${token}/download`}>Download</a>
          </Button>
        )}
      </header>
      {entry.kind === 'markdown' ? <MarkdownPreview body={body ?? ''} /> : null}
      {entry.kind === 'folder' ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {entries.map((child) => (
            <li key={child.id}>
              <Link
                href={`/share/files/${child.publicToken}`}
                className="flex items-center gap-3 px-4 py-3 text-dense text-text hover:bg-surface-2"
              >
                {child.kind === 'folder' ? (
                  <Folder className="size-5 text-accent" />
                ) : (
                  <File className="size-5 text-muted" />
                )}
                {child.name}
              </Link>
            </li>
          ))}
          {entries.length === 0 ? (
            <li className="px-4 py-10 text-center text-muted">This folder is empty.</li>
          ) : null}
        </ul>
      ) : null}
      {entry.kind === 'file' ? (
        <FilePreview entry={entry} downloadPath={`/api/public/files/${token}/download`} />
      ) : null}
    </main>
  );
}

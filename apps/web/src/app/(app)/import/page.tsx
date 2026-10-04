import { IMPORT_TARGETS } from '@gravity/shared/import';
import type { Metadata } from 'next';
import { ImportScreen } from '@/features/import/import-screen.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Import' };

export default async function ImportPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await pageContext();
  const params = await searchParams;
  const rawTarget = typeof params['target'] === 'string' ? params['target'] : '';
  const pipeline = typeof params['pipeline'] === 'string' ? params['pipeline'] : null;
  return (
    <ImportScreen
      initialTarget={IMPORT_TARGETS.find((target) => target === rawTarget) ?? 'people'}
      initialPipelineKey={pipeline}
    />
  );
}

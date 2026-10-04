import type { Metadata } from 'next';
import { PipelinePanel } from '@/features/settings/pipeline-panel.tsx';

export const metadata: Metadata = { title: 'Pipeline' };

export default async function PipelineSettingsPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PipelinePanel pipelineId={id} />;
}

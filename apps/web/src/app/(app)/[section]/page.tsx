import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { navItemFor } from '@/lib/navigation.ts';

export default async function SectionPage({
  params,
}: {
  readonly params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const item = navItemFor(section);
  if (item === undefined || item.id === 'settings') notFound();
  return (
    <EmptyState
      title={item.label}
      description={`Nothing here yet. ${item.label} arrives in the next milestone.`}
    />
  );
}

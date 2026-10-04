'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button.tsx';
import { useCan } from '@/features/workspace/use-can.ts';

export function ImportLink({ href }: { readonly href: string }) {
  const canImport = useCan('import:run');
  if (!canImport) return null;
  return (
    <Button asChild size="sm">
      <Link href={href}>Import a file</Link>
    </Button>
  );
}

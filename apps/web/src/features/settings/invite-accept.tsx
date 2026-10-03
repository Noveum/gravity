'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button.tsx';
import { apiFetch, messageOf } from '@/lib/api/client.ts';

const acceptedSchema = z.object({ organizationId: z.string() });

export interface InviteAcceptProps {
  readonly token: string;
  readonly workspaceName: string;
}

export function InviteAccept({ token, workspaceName }: InviteAcceptProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/invites/accept/${token}`, acceptedSchema, { method: 'POST' });
      router.push('/today');
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button variant="primary" block onClick={accept} disabled={pending}>
        {pending ? 'Joining' : `Join ${workspaceName}`}
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

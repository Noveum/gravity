'use client';

import { useRouter } from 'next/navigation';
import { z } from 'zod';
import {
  CreateWorkspaceForm,
  type CreateWorkspaceInput,
} from '@/features/workspaces/create-workspace-form.tsx';
import { apiFetch } from '@/lib/api/client.ts';

const createdSchema = z.object({ organization: z.object({ id: z.string() }) });

export default function OnboardingPage() {
  const router = useRouter();

  return (
    <div className="flex w-full flex-col gap-5 rounded-xl border border-border bg-surface p-6 shadow-pop sm:p-7">
      <div className="flex flex-col gap-1">
        <h1 className="font-medium text-text-strong text-xl">Create your workspace</h1>
        <p className="text-muted text-xs">
          A workspace holds your people, companies, deals and outreach. You can invite teammates
          next.
        </p>
      </div>
      <CreateWorkspaceForm
        submit={(input: CreateWorkspaceInput) =>
          apiFetch('/api/organizations', createdSchema, { method: 'POST', body: input })
        }
        onCreated={() => router.replace('/today')}
      />
    </div>
  );
}

'use client';

import { type FormEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { messageOf } from '@/lib/api/client.ts';

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly slug: string;
}

interface Props {
  readonly submit: (input: CreateWorkspaceInput) => Promise<{ organization: { id: string } }>;
  readonly onCreated: (organizationId: string) => void;
}

function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function CreateWorkspaceForm({ submit, onCreated }: Props) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const nameId = useId();
  const slugId = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const created = await submit({ name: name.trim(), slug });
      onCreated(created.organization.id);
    } catch (caught: unknown) {
      setError(messageOf(caught, 'Could not create the workspace.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5 text-dense text-text">
        <label htmlFor={nameId}>Workspace name</label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugTouched) setSlug(slugFrom(event.target.value));
          }}
          required
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5 text-dense text-text">
        <label htmlFor={slugId}>URL</label>
        <Input
          id={slugId}
          value={slug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(slugFrom(event.target.value));
          }}
          required
        />
      </div>
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        block
        disabled={pending || name.trim() === '' || slug === ''}
      >
        Create workspace
      </Button>
    </form>
  );
}

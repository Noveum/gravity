'use client';

import { companyDomainFromEmail, parseIdentityInput, randomUUIDv7 } from '@gravity/shared/utils';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { focusBack } from '@/features/leads/verb-picker.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { HOTKEY_PRIORITY, useHotkey } from '@/lib/keyboard/index.ts';
import { lastPipelineKey } from '@/lib/last-pipeline.ts';
import {
  matchCachedPeople,
  mergeHits,
  type PersonHit,
  personHitOf,
} from '@/lib/query/record-search.ts';
import { useBootstrap } from '@/lib/query/use-bootstrap.ts';
import { type QuickCreateInput, useQuickCreateLead } from '@/lib/query/use-lead-mutations.ts';
import { useDuplicates } from '@/lib/query/use-record-search.ts';
import { buildQuickCreate } from './quick-create-form.ts';

const OPEN_LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const selectClassName =
  'h-8 rounded-md border border-border bg-surface px-2 text-dense text-text focus-visible:border-accent';

function probeNameOf(parsed: ReturnType<typeof parseIdentityInput>, typed: string): string | null {
  if (parsed?.kind === 'name') return parsed.name;
  const trimmed = typed.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface QuickCreateDialogProps {
  readonly onClose: () => void;
  readonly onCreate: (input: QuickCreateInput) => void;
  readonly returnFocus: () => HTMLElement | null;
}

function QuickCreateDialog({ onClose, onCreate, returnFocus }: QuickCreateDialogProps) {
  const workspace = useWorkspace();
  const bootstrap = useBootstrap().data;
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const personInput = useRef<HTMLInputElement | null>(null);
  const ids = { pipeline: useId(), owner: useId() };
  const routeKey = pathname.startsWith('/leads/') ? (pathname.split('/')[2] ?? '') : '';
  const initialPipeline =
    workspace.pipelineByKey.get(routeKey) ??
    workspace.pipelineByKey.get(lastPipelineKey(workspace.userId) ?? '') ??
    workspace.pipelines[0];
  const [identity, setIdentity] = useState('');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyDomain, setCompanyDomain] = useState<string | null>(null);
  const [pipelineId, setPipelineId] = useState(initialPipeline?.id ?? '');
  const [ownerId, setOwnerId] = useState<string>(workspace.userId);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseIdentityInput(identity);
  const email = parsed?.kind === 'email' ? parsed.email : null;
  const linkedinUrl = parsed?.kind === 'linkedin' ? parsed.linkedinUrl : null;
  const domain = companyDomain ?? (email === null ? '' : (companyDomainFromEmail(email) ?? ''));
  const probeName = probeNameOf(parsed, name);
  const probe = useMemo(
    () => ({ email, linkedinUrl, name: probeName }),
    [email, linkedinUrl, probeName],
  );
  const local = useMemo(() => matchCachedPeople(client, probe), [client, probe]);
  const remote = useDuplicates(probe);
  const matches: PersonHit[] = mergeHits(local, (remote.data?.people ?? []).map(personHitOf));

  const submit = () => {
    const pipeline = workspace.pipelineById.get(pipelineId);
    if (pipeline === undefined || bootstrap === undefined) {
      setError('Choose a pipeline.');
      return;
    }
    const built = buildQuickCreate(
      {
        identity,
        name,
        companyName,
        companyDomain: domain,
        pipelineId,
        ownerId: ownerId === '' ? null : ownerId,
      },
      {
        leadId: randomUUIDv7(),
        pipeline,
        stages: bootstrap.stages,
        organizationId: bootstrap.organization.id,
        now: new Date(),
      },
    );
    if ('error' in built) {
      setError(built.error);
      return;
    }
    onCreate(built);
    onClose();
  };
  useHotkey('mod+enter', submit, {
    label: 'Create',
    section: 'General',
    allowInInput: true,
    priority: HOTKEY_PRIORITY.layer,
  });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        data-testid="quick-create"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          personInput.current?.focus();
        }}
        onCloseAutoFocus={focusBack(returnFocus)}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a person</DialogTitle>
          </DialogHeader>
          <Input
            ref={personInput}
            aria-label="Person"
            placeholder="Paste a LinkedIn URL, an email or a name"
            value={identity}
            onChange={(event) => {
              setIdentity(event.target.value);
              setError(null);
            }}
          />
          {parsed !== null && parsed.kind !== 'name' ? (
            <Input
              aria-label="Name"
              placeholder="Full name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          ) : null}
          {matches.length === 0 ? null : (
            <section
              aria-label="Already in Gravity"
              className="flex flex-col gap-0.5 rounded-md border border-border p-1"
            >
              <h3 className="px-2 py-1 text-faint text-xs">Already in Gravity</h3>
              {matches.map((person) => (
                <Button
                  key={person.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  aria-label={`Open ${person.name}`}
                  onClick={() => {
                    onClose();
                    router.push(`/people/${person.id}`);
                  }}
                >
                  <span className="truncate text-text">{person.name}</span>
                  <span className="truncate text-faint">
                    {person.email ?? person.companyName ?? ''}
                  </span>
                </Button>
              ))}
            </section>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="Company"
              placeholder="Company"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
            />
            <Input
              aria-label="Company domain"
              placeholder="acme.com"
              value={domain}
              onChange={(event) => setCompanyDomain(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-dense">
            <label htmlFor={ids.pipeline} className="flex flex-col gap-1 text-faint text-xs">
              Pipeline
              <select
                id={ids.pipeline}
                value={pipelineId}
                onChange={(event) => setPipelineId(event.target.value)}
                className={selectClassName}
              >
                {workspace.pipelines.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {workspace.brandById.get(pipeline.brandId)?.name ?? ''} · {pipeline.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={ids.owner} className="flex flex-col gap-1 text-faint text-xs">
              Owner
              <select
                id={ids.owner}
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
                className={selectClassName}
              >
                <option value="">Unassigned</option>
                {workspace.members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error === null ? null : (
            <p role="alert" className="text-danger text-xs">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" variant="primary">
              Create <Kbd keys={['mod', 'enter']} />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function QuickCreate() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const create = useQuickCreateLead();
  useHotkey(
    'c',
    () => {
      if (document.querySelector(OPEN_LAYERS) !== null) return;
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    },
    {
      label: 'Quick create',
      section: 'General',
      priority: HOTKEY_PRIORITY.surface,
      enabled: !open,
    },
  );
  if (!open) return null;
  return (
    <QuickCreateDialog
      onClose={() => setOpen(false)}
      onCreate={(input) => create.mutate(input)}
      returnFocus={() => (opener.current?.isConnected === true ? opener.current : null)}
    />
  );
}

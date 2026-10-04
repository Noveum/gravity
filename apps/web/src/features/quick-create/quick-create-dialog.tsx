'use client';

import type { CompanyRow } from '@gravity/shared/records';
import {
  companyDomainFromEmail,
  normalizeDomain,
  parseIdentityInput,
  randomUUIDv7,
} from '@gravity/shared/utils';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { MAX_LIST_SEARCH_LENGTH } from '@/features/filters/list-query.ts';
import { focusBack } from '@/features/leads/verb-picker.tsx';
import { useCan } from '@/features/workspace/use-can.ts';
import { useWorkspace, type WorkspaceData } from '@/features/workspace/use-workspace.ts';
import { HOTKEY_PRIORITY, KEYBOARD_PASSTHROUGH, useHotkey } from '@/lib/keyboard/index.ts';
import { lastPipelineKey } from '@/lib/last-pipeline.ts';
import {
  matchCachedCompanies,
  matchCachedPeople,
  mergeHits,
  type PersonHit,
  personHitOf,
  type RecordProbe,
} from '@/lib/query/record-search.ts';
import { useBootstrap } from '@/lib/query/use-bootstrap.ts';
import { type QuickCreateInput, useQuickCreateLead } from '@/lib/query/use-lead-mutations.ts';
import { useDuplicates } from '@/lib/query/use-record-search.ts';
import { buildQuickCreate, type QuickCreateDraft } from './quick-create-form.ts';

const OPEN_LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const selectClassName =
  'h-8 rounded-md border border-border bg-surface px-2 text-dense text-text focus-visible:border-accent';

function probeNameOf(parsed: ReturnType<typeof parseIdentityInput>, typed: string): string | null {
  if (parsed?.kind === 'name') return parsed.name;
  const trimmed = typed.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const matchSectionClassName = 'flex flex-col gap-0.5 rounded-md border border-border p-1';
const matchRowClassName = 'w-full justify-start gap-2';

function PersonMatches({
  people,
  onOpen,
}: {
  readonly people: readonly PersonHit[];
  readonly onOpen: (person: PersonHit) => void;
}) {
  if (people.length === 0) return null;
  return (
    <section aria-label="Already in Gravity" className={matchSectionClassName}>
      <h3 className="px-2 py-1 text-faint text-xs">Already in Gravity</h3>
      {people.map((person) => (
        <Button
          key={person.id}
          type="button"
          variant="ghost"
          size="sm"
          className={matchRowClassName}
          aria-label={`Open ${person.name}`}
          onClick={() => onOpen(person)}
        >
          <span className="truncate text-text">{person.name}</span>
          <span className="truncate text-faint">{person.email ?? person.companyName ?? ''}</span>
        </Button>
      ))}
    </section>
  );
}

function CompanyMatches({
  companies,
  onUse,
}: {
  readonly companies: readonly CompanyRow[];
  readonly onUse: (company: CompanyRow) => void;
}) {
  if (companies.length === 0) return null;
  return (
    <section aria-label="Companies already in Gravity" className={matchSectionClassName}>
      <h3 className="px-2 py-1 text-faint text-xs">Companies already in Gravity</h3>
      {companies.map((company) => (
        <Button
          key={company.id}
          type="button"
          variant="ghost"
          size="sm"
          className={matchRowClassName}
          aria-label={`Use ${company.name}`}
          onClick={() => onUse(company)}
        >
          <span className="truncate text-text">{company.name}</span>
          <span className="truncate text-faint">{company.primaryDomain ?? ''}</span>
        </Button>
      ))}
    </section>
  );
}

function useDuplicateMatches(probe: RecordProbe) {
  const client = useQueryClient();
  const localPeople = useMemo(() => matchCachedPeople(client, probe), [client, probe]);
  const localCompanies = useMemo(
    () => matchCachedCompanies(client, probe.domain),
    [client, probe.domain],
  );
  const remote = useDuplicates(probe);
  return {
    people: mergeHits(localPeople, (remote.data?.people ?? []).map(personHitOf)),
    companies: mergeHits(localCompanies, remote.data?.companies ?? []),
  };
}

function PipelineOwnerFields({
  workspace,
  pipelineId,
  ownerId,
  onPipeline,
  onOwner,
}: {
  readonly workspace: WorkspaceData;
  readonly pipelineId: string;
  readonly ownerId: string;
  readonly onPipeline: (id: string) => void;
  readonly onOwner: (id: string) => void;
}) {
  const ids = { pipeline: useId(), owner: useId() };
  return (
    <div className="grid grid-cols-2 gap-2 text-dense">
      <label htmlFor={ids.pipeline} className="flex flex-col gap-1 text-faint text-xs">
        Pipeline
        <select
          id={ids.pipeline}
          value={pipelineId}
          onChange={(event) => onPipeline(event.target.value)}
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
          onChange={(event) => onOwner(event.target.value)}
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
  );
}

function useInitialPipelineId(workspace: WorkspaceData): string {
  const pathname = usePathname();
  const routeKey = pathname.startsWith('/leads/') ? (pathname.split('/')[2] ?? '') : '';
  const initial =
    workspace.pipelineByKey.get(routeKey) ??
    workspace.pipelineByKey.get(lastPipelineKey(workspace.userId) ?? '') ??
    workspace.pipelines[0];
  return initial?.id ?? '';
}

interface Reopened {
  readonly draft: QuickCreateDraft | null;
  readonly error: string | null;
}

interface QuickCreateDialogProps extends Reopened {
  readonly onClose: () => void;
  readonly onCreate: (input: QuickCreateInput, draft: QuickCreateDraft) => void;
  readonly returnFocus: () => HTMLElement | null;
}

function QuickCreateDialog({
  draft,
  error: reopenedError,
  onClose,
  onCreate,
  returnFocus,
}: QuickCreateDialogProps) {
  const workspace = useWorkspace();
  const bootstrap = useBootstrap().data;
  const router = useRouter();
  const personInput = useRef<HTMLInputElement | null>(null);
  const initialPipelineId = useInitialPipelineId(workspace);
  const [identity, setIdentity] = useState(draft?.identity ?? '');
  const [name, setName] = useState(draft?.name ?? '');
  const [companyName, setCompanyName] = useState(draft?.companyName ?? '');
  const [companyDomain, setCompanyDomain] = useState<string | null>(draft?.companyDomain ?? null);
  const [pipelineChoice, setPipelineChoice] = useState<string | null>(draft?.pipelineId ?? null);
  const [ownerChoice, setOwnerChoice] = useState<string | null>(draft?.ownerId ?? null);
  const [error, setError] = useState<string | null>(reopenedError);
  const pipelineId = pipelineChoice ?? initialPipelineId;
  const ownerId = ownerChoice ?? (draft === null ? workspace.userId : '');

  const parsed = parseIdentityInput(identity);
  const email = parsed?.kind === 'email' ? parsed.email : null;
  const linkedinUrl = parsed?.kind === 'linkedin' ? parsed.linkedinUrl : null;
  const domain = companyDomain ?? (email === null ? '' : (companyDomainFromEmail(email) ?? ''));
  const probeName = probeNameOf(parsed, name);
  const probeDomain = normalizeDomain(domain);
  const probe = useMemo(
    () => ({ email, linkedinUrl, name: probeName, domain: probeDomain }),
    [email, linkedinUrl, probeName, probeDomain],
  );
  const found = useDuplicateMatches(probe);
  const companyMatches = found.companies.filter(
    (company) => company.name !== companyName.trim() || company.primaryDomain !== domain,
  );

  const submit = () => {
    if (!workspace.ready || bootstrap === undefined) return;
    const pipeline = workspace.pipelineById.get(pipelineId);
    if (pipeline === undefined) {
      setError('Choose a pipeline.');
      return;
    }
    const filled: QuickCreateDraft = {
      identity,
      name,
      companyName,
      companyDomain: domain,
      pipelineId,
      ownerId: ownerId === '' ? null : ownerId,
    };
    const built = buildQuickCreate(filled, {
      leadId: randomUUIDv7(),
      pipeline,
      stages: bootstrap.stages,
      organizationId: bootstrap.organization.id,
      now: new Date(),
    });
    if ('error' in built) {
      setError(built.error);
      return;
    }
    onCreate(built, filled);
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
              maxLength={MAX_LIST_SEARCH_LENGTH}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          ) : null}
          <PersonMatches
            people={found.people}
            onOpen={(person) => {
              onClose();
              router.push(`/people/${person.id}`);
            }}
          />
          <CompanyMatches
            companies={companyMatches}
            onUse={(company) => {
              setCompanyName(company.name);
              setCompanyDomain(company.primaryDomain ?? '');
            }}
          />
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
          {workspace.ready ? null : (
            <p role="status" className="text-faint text-xs">
              Loading your workspace
            </p>
          )}
          <PipelineOwnerFields
            workspace={workspace}
            pipelineId={pipelineId}
            ownerId={ownerId}
            onPipeline={setPipelineChoice}
            onOwner={setOwnerChoice}
          />
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

const KEPT_DRAFTS = 20;

function layerIsOpen(): boolean {
  return [...document.querySelectorAll(OPEN_LAYERS)].some(
    (layer) => !layer.hasAttribute(KEYBOARD_PASSTHROUGH),
  );
}

export function QuickCreate() {
  const workspaceKnown = useWorkspace().ready;
  const canWrite = useCan('record:write');
  const readOnly = workspaceKnown && !canWrite;
  const [session, setSession] = useState<Reopened | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = useRef(false);
  const drafts = useRef(new Map<string, QuickCreateDraft>());
  useEffect(() => {
    open.current = session !== null;
  }, [session]);
  const create = useQuickCreateLead({
    onRefused: (input, message) => {
      const draft = drafts.current.get(input.preview.id);
      if (draft === undefined || open.current) return false;
      setSession({ draft, error: message });
      return true;
    },
  });
  useHotkey(
    'c',
    () => {
      if (layerIsOpen()) return;
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setSession({ draft: null, error: null });
    },
    {
      label: 'Quick create',
      section: 'General',
      priority: HOTKEY_PRIORITY.surface,
      enabled: !readOnly && session === null,
    },
  );
  if (session === null) return null;
  return (
    <QuickCreateDialog
      draft={session.draft}
      error={session.error}
      onClose={() => setSession(null)}
      onCreate={(input, draft) => {
        drafts.current.set(input.preview.id, draft);
        const [oldest] = drafts.current.keys();
        if (drafts.current.size > KEPT_DRAFTS && oldest !== undefined) {
          drafts.current.delete(oldest);
        }
        create.mutate(input);
      }}
      returnFocus={() => (opener.current?.isConnected === true ? opener.current : null)}
    />
  );
}

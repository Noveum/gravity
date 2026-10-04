'use client';

import { GRAVITY_APPROVE_SCOPE, MCP_SCOPE_LABELS } from '@gravity/shared/constants';
import { isAllowedRedirectUri } from '@gravity/shared/utils';
import { Check, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { NativeSelect } from '@/components/ui/native-select.tsx';
import { authClient } from '@/lib/auth/client.ts';
import { useHotkey } from '@/lib/keyboard/index.ts';

export interface ConsentOrganization {
  readonly id: string;
  readonly name: string;
}

export interface ConsentFormProps {
  readonly consentCode: string;
  readonly clientName: string;
  readonly clientLogo?: string | null;
  readonly redirectHost: string;
  readonly scopes: readonly string[];
  readonly organizations: readonly ConsentOrganization[];
  readonly requirePasskey: boolean;
  readonly userEmail: string;
}

const decisionResponseSchema = z.object({
  status: z.string().optional(),
  redirectUri: z.string().optional(),
  message: z.string().optional(),
});

const passkeySignInSchema = z.object({ user: z.object({ email: z.string() }) });

type DecisionResponse = z.infer<typeof decisionResponseSchema>;
type Decision = 'allow' | 'deny';

interface DecisionRequest {
  readonly decision: Decision;
  readonly consentCode: string;
  readonly organizationId?: string;
  readonly allowApproval?: boolean;
}

const RESTART = 'Start the connection again from your AI client.';

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : RESTART;
}

async function postDecision(request: DecisionRequest): Promise<DecisionResponse> {
  const response = await fetch('/oauth/authorize/decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const parsed = decisionResponseSchema.safeParse(await response.json().catch(() => ({})));
  const data = parsed.success ? parsed.data : {};
  if (response.ok) return data;
  throw new Error(data.message ?? `Gravity could not complete the connection. ${RESTART}`);
}

function returnToClient(data: DecisionResponse): void {
  if (data.redirectUri === undefined) {
    throw new Error(data.message ?? `Gravity could not complete the connection. ${RESTART}`);
  }
  if (!isAllowedRedirectUri(data.redirectUri)) {
    throw new Error(
      `The client sent back an unsafe address, so Gravity did not open it. ${RESTART}`,
    );
  }
  window.location.assign(data.redirectUri);
}

async function verifyWithPasskey(userEmail: string): Promise<void> {
  const result = await authClient.signIn.passkey();
  if (result?.error) {
    throw new Error(result.error.message ?? 'Passkey verification failed. Try again.');
  }
  const signedIn = passkeySignInSchema.safeParse(result?.data);
  if (signedIn.success && signedIn.data.user.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new Error(
      `That passkey belongs to another account. Sign in as ${userEmail} to continue.`,
    );
  }
}

function useDecisionRun() {
  const [pending, setPending] = useState<Decision | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  function run(decision: Decision, work: () => Promise<void>): void {
    if (pending !== null) return;
    setPending(decision);
    setFailure(null);
    work().catch((error: unknown) => {
      setPending(null);
      setFailure(messageOf(error));
    });
  }
  return { pending, failure, setFailure, run };
}

function FailureNotice({ message }: { readonly message: string | null }) {
  if (message === null) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-border bg-surface-2 p-3 text-2xs text-danger"
    >
      {message}
    </p>
  );
}

export function DenyConnection({ consentCode }: { readonly consentCode: string }) {
  const { pending, failure, run } = useDecisionRun();
  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="secondary"
        block
        aria-busy={pending === 'deny'}
        onClick={() =>
          run('deny', async () =>
            returnToClient(await postDecision({ decision: 'deny', consentCode })),
          )
        }
      >
        Deny and return to the client
      </Button>
      <FailureNotice message={failure} />
    </div>
  );
}

function ClientLogo({ name, src }: { readonly name: string; readonly src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-md border border-border bg-surface-2 font-medium text-dense text-muted"
      >
        {Array.from(name.trim())[0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: a client logo on a third-party host must not go through the image optimizer
    <img
      data-testid="client-logo"
      src={src}
      alt=""
      width={36}
      height={36}
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-9 rounded-md border border-border bg-surface-2 object-contain"
    />
  );
}

export function ConsentForm({
  consentCode,
  clientName,
  clientLogo = null,
  redirectHost,
  scopes,
  organizations,
  requirePasskey,
  userEmail,
}: ConsentFormProps) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [allowApproval, setAllowApproval] = useState(false);
  const { pending, failure, setFailure, run } = useDecisionRun();
  const permissions = scopes.filter(
    (scope) => scope !== GRAVITY_APPROVE_SCOPE && MCP_SCOPE_LABELS[scope] !== undefined,
  );
  const asksApproval = scopes.includes(GRAVITY_APPROVE_SCOPE);
  const ids = { workspace: useId(), approval: useId(), warning: useId() };
  const workspacePicker = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    workspacePicker.current?.focus();
  }, []);

  async function approve(verified: boolean): Promise<void> {
    const data = await postDecision({
      decision: 'allow',
      consentCode,
      organizationId,
      allowApproval,
    });
    if (data.status !== 'passkey_required') {
      returnToClient(data);
      return;
    }
    if (verified) throw new Error('Passkey verification did not complete. Try again.');
    await verifyWithPasskey(userEmail);
    await approve(true);
  }

  function allow(): void {
    if (organizationId === '') {
      setFailure('Choose a workspace first.');
      return;
    }
    run('allow', () => approve(false));
  }

  function deny(): void {
    run('deny', async () => returnToClient(await postDecision({ decision: 'deny', consentCode })));
  }

  useHotkey('mod+enter', allow, {
    label: 'Approve the connection',
    allowInInput: true,
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <ClientLogo name={clientName} src={clientLogo} />
        <p className="text-muted text-sm">
          <span className="font-medium text-text">{clientName}</span> wants to act in Gravity as{' '}
          <span className="font-medium text-text">{userEmail}</span>.
        </p>
        <p className="text-2xs text-faint">
          The name and logo are provided by the app and not verified by Gravity.
        </p>
      </div>
      <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-center text-dense text-muted">
        Gravity will send you back to{' '}
        <span className="inline-block max-w-full break-all font-medium font-mono text-text">
          {redirectHost}
        </span>
      </p>
      <label htmlFor={ids.workspace} className="flex flex-col gap-1.5 text-2xs text-faint">
        Workspace
        <NativeSelect
          id={ids.workspace}
          ref={workspacePicker}
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      {permissions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-2xs text-faint">It will be able to</span>
          <ul className="flex flex-col gap-1.5">
            {permissions.map((scope) => (
              <li key={scope} className="flex items-start gap-2 text-dense text-text">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                {MCP_SCOPE_LABELS[scope]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {asksApproval ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 p-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id={ids.approval}
              checked={allowApproval}
              onCheckedChange={(checked) => setAllowApproval(checked === true)}
              aria-describedby={ids.warning}
              className="mt-0.5"
            />
            <label htmlFor={ids.approval} className="cursor-pointer text-dense text-text">
              {MCP_SCOPE_LABELS[GRAVITY_APPROVE_SCOPE]}
            </label>
          </div>
          <p id={ids.warning} className="flex items-start gap-1.5 text-2xs text-warning">
            <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
            Leave this off unless you want this client to approve messages without asking you.
          </p>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" block aria-busy={pending === 'deny'} onClick={deny}>
          Deny
        </Button>
        <Button
          type="button"
          variant="primary"
          block
          aria-busy={pending === 'allow'}
          onClick={allow}
        >
          Approve
          <Kbd keys={['mod', 'enter']} className="ml-1" aria-hidden="true" />
        </Button>
      </div>
      {requirePasskey && failure === null ? (
        <p className="text-center text-2xs text-faint">
          Approving may ask you to verify with your passkey.
        </p>
      ) : null}
      <FailureNotice message={failure} />
    </div>
  );
}

'use client';

import { GRAVITY_APPROVE_SCOPE } from '@gravity/shared/constants';
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, PlugZap } from 'lucide-react';
import { type RefObject, useRef, useState } from 'react';
import { z } from 'zod';
import { ClientLogo } from '@/components/client-logo.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { EmptyState } from '@/components/ui/empty-state.tsx';
import { ErrorState } from '@/components/ui/error-state.tsx';
import { RelativeTime } from '@/components/ui/relative-time.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { ApiError, apiFetch } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { useRetryToast } from '@/lib/query/use-retry-toast.ts';
import { useDelayedFlag } from '@/lib/use-delayed-flag.ts';
import { focusNeighbourOf } from './focus.ts';

const connectionSchema = z.object({
  id: z.string(),
  clientName: z.string(),
  clientLogo: z.string().nullable(),
  redirectHosts: z.array(z.string()),
  organizationName: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
type Connection = z.infer<typeof connectionSchema>;
const connectionsSchema = z.object({ connections: z.array(connectionSchema) });
type Connections = z.infer<typeof connectionsSchema>;
const revokedSchema = z.object({ ok: z.literal(true) });
const GRAVITY_PREFIX = 'gravity.';

function primaryHost(connection: Connection): string | null {
  return connection.redirectHosts[0] ?? null;
}

function revokeLabel(connection: Connection): string {
  const host = primaryHost(connection);
  return host === null
    ? `Revoke ${connection.clientName}`
    : `Revoke ${connection.clientName} (${host})`;
}
const SKELETON_ROWS = ['a', 'b', 'c'];

function ConnectionsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col">
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="flex h-7 items-center gap-2 px-2">
          <Skeleton className="size-5 rounded-sm" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

function ConnectionRow({
  connection,
  busy,
  onRevoke,
}: {
  readonly connection: Connection;
  readonly busy: boolean;
  readonly onRevoke: (button: HTMLButtonElement) => void;
}) {
  const scopes = connection.scopes.filter((scope) => scope.startsWith(GRAVITY_PREFIX));
  return (
    <li
      aria-label={connection.clientName}
      aria-busy={busy}
      data-connection-id={connection.id}
      className={cn('flex flex-col rounded-md px-2 py-0.5', rowHover)}
    >
      <div className="flex h-7 items-center gap-2 text-dense">
        <ClientLogo name={connection.clientName} src={connection.clientLogo} size="sm" />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate font-medium text-text">{connection.clientName}</span>
          <span className="truncate text-muted">{connection.organizationName}</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={revokeLabel(connection)}
          onClick={(event) => onRevoke(event.currentTarget)}
        >
          Revoke
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1 pl-7 text-2xs text-faint">
        {scopes.length === 0 ? null : (
          <span className="flex flex-wrap gap-1">
            {scopes.map((scope) => (
              <Badge key={scope} tone={scope === GRAVITY_APPROVE_SCOPE ? 'warning' : 'neutral'}>
                {scope}
              </Badge>
            ))}
          </span>
        )}
        {connection.redirectHosts.length === 0 ? null : (
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            Returns to
            {connection.redirectHosts.map((host) => (
              <span key={host} className="break-all font-mono text-muted">
                {host}
              </span>
            ))}
          </span>
        )}
        <span>
          Connected <RelativeTime at={connection.createdAt} />
        </span>
        {connection.lastUsedAt === null ? (
          <span>Never used</span>
        ) : (
          <span>
            Last used <RelativeTime at={connection.lastUsedAt} />
          </span>
        )}
      </div>
    </li>
  );
}

function ConnectionsView({
  query,
  loading,
  list,
  busy,
  onRevoke,
}: {
  readonly query: UseQueryResult<Connections>;
  readonly loading: boolean;
  readonly list: RefObject<HTMLUListElement | null>;
  readonly busy: ReadonlySet<string>;
  readonly onRevoke: (connection: Connection, button: HTMLButtonElement) => void;
}) {
  if (query.data === undefined) {
    if (query.error !== null) {
      return (
        <ErrorState
          title="Could not load your MCP clients"
          error={query.error}
          onRetry={() => {
            query.refetch().catch(() => undefined);
          }}
        />
      );
    }
    return loading ? <ConnectionsSkeleton /> : null;
  }
  if (query.data.connections.length === 0) {
    return (
      <EmptyState
        icon={<PlugZap />}
        title="No agents are connected yet."
        description="Paste the server URL into your MCP client and approve it here."
      />
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <p className="text-2xs text-faint">
        Names and logos are provided by each app and not verified by Gravity. Check the address an
        app returns to.
      </p>
      <ul ref={list} className="flex flex-col">
        {query.data.connections.map((connection) => (
          <ConnectionRow
            key={connection.id}
            connection={connection}
            busy={busy.has(connection.id)}
            onRevoke={(button) => onRevoke(connection, button)}
          />
        ))}
      </ul>
    </section>
  );
}

export function McpPanel({ serverUrl }: { readonly serverUrl: string }) {
  const client = useQueryClient();
  const { toast } = useToast();
  const retryToast = useRetryToast();
  const [confirming, setConfirming] = useState<Connection | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const opener = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const connections = useQuery({
    queryKey: queryKeys.mcpGrants,
    queryFn: () => apiFetch('/api/mcp-grants', connectionsSchema),
    staleTime: 0,
  });
  const loading = useDelayedFlag(connections.isPending);

  function handOffFocus(id: string): void {
    const row = list.current?.querySelector(`[data-connection-id="${id}"]`) ?? null;
    const active = document.activeElement;
    const lost =
      row !== null &&
      (active === null ||
        active === document.body ||
        row.contains(active) ||
        active.closest('[role="dialog"]') !== null);
    if (lost) focusNeighbourOf(row, copyButton.current);
  }

  function track(id: string, active: boolean): void {
    if (active) inFlight.current.add(id);
    else inFlight.current.delete(id);
    setBusy(new Set(inFlight.current));
  }

  const revoke = useMutation({
    mutationFn: (connection: Connection) =>
      apiFetch(`/api/mcp-grants/${connection.id}`, revokedSchema, { method: 'DELETE' }),
    onSuccess: async (_result, connection) => {
      handOffFocus(connection.id);
      await client.cancelQueries({ queryKey: queryKeys.mcpGrants });
      client.setQueryData(queryKeys.mcpGrants, (current: Connections | undefined) =>
        current === undefined
          ? current
          : { connections: current.connections.filter((entry) => entry.id !== connection.id) },
      );
      toast({
        title: `Revoked ${connection.clientName}`,
        description: 'It must connect again to use Gravity.',
      });
    },
    onSettled: (_result, _error, connection) => track(connection.id, false),
    onError: (error, connection) => {
      retryToast(`Could not revoke ${connection.clientName}`, error, () => startRevoke(connection));
      if (error instanceof ApiError && error.status === 404) {
        client.invalidateQueries({ queryKey: queryKeys.mcpGrants }).catch(() => undefined);
      }
    },
  });

  function startRevoke(connection: Connection): void {
    if (inFlight.current.has(connection.id)) return;
    track(connection.id, true);
    revoke.mutate(connection);
  }

  function copyUrl(): void {
    navigator.clipboard
      .writeText(serverUrl)
      .then(() => toast({ title: 'Server URL copied' }))
      .catch(() => toast({ title: 'Could not copy the URL', tone: 'danger' }));
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text-strong">MCP clients</h2>
        <p className="text-muted text-xs">
          Agents connect over OAuth. Add this server to any MCP client and approve it for one
          workspace.
        </p>
      </header>
      <div className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-surface-2 py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 select-all break-all font-mono text-dense text-text">
          {serverUrl}
        </code>
        <Button
          ref={copyButton}
          size="sm"
          variant="ghost"
          onClick={copyUrl}
          aria-label="Copy server URL"
        >
          <Copy className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <ConnectionsView
        query={connections}
        loading={loading}
        list={list}
        busy={busy}
        onRevoke={(connection, button) => {
          opener.current = button;
          setConfirming(connection);
        }}
      />
      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? undefined : setConfirming(null))}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Revoke {confirming?.clientName}?</DialogTitle>
            <DialogDescription>
              {confirming === null || primaryHost(confirming) === null
                ? ''
                : `${confirming.clientName} returns to ${primaryHost(confirming)}. `}
              Its tokens for {confirming?.organizationName} stop working at once. It can connect
              again only after you approve it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirming !== null) startRevoke(confirming);
                setConfirming(null);
              }}
            >
              Revoke access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

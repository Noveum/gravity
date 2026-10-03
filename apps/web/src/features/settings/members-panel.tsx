'use client';

import { ORG_ROLES, type OrgRole } from '@gravity/shared/constants';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { z } from 'zod';
import { Avatar } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { apiFetch, messageOf } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import { registerDeltaHandler } from '@/lib/realtime/delta-bridge.tsx';

const ROLE_LABELS: Record<OrgRole, string> = {
  admin: 'Admin',
  member: 'Member',
  contributor: 'Contributor',
  guest: 'Guest',
};

const acknowledgedSchema = z.object({ token: z.string().optional() });

export interface MemberView {
  readonly memberId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  readonly role: OrgRole;
}

export interface PendingInviteView {
  readonly id: string;
  readonly email: string;
  readonly role: OrgRole;
}

export interface MembersPanelProps {
  readonly currentUserId: string;
  readonly members: readonly MemberView[];
  readonly invites: readonly PendingInviteView[];
  readonly canInvite: boolean;
  readonly canInviteAdmins: boolean;
  readonly canManage: boolean;
  readonly canDeliverInvites: boolean;
}

function roleFrom(value: string): OrgRole {
  return ORG_ROLES.find((role) => role === value) ?? 'member';
}

function RoleSelect({
  label,
  value,
  roles,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: OrgRole;
  readonly roles: readonly OrgRole[];
  readonly disabled: boolean;
  readonly onChange: (role: OrgRole) => void;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(next) => onChange(roleFrom(next))}>
      <SelectTrigger className="h-7 w-36 text-xs" aria-label={label}>
        <SelectValue>{ROLE_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role} value={role}>
            {ROLE_LABELS[role]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MembersPanel({
  currentUserId,
  members,
  invites,
  canInvite,
  canInviteAdmins,
  canManage,
  canDeliverInvites,
}: MembersPanelProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let queued = false;
    const refresh = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (active) router.refresh();
      });
    };
    const unregisterMember = registerDeltaHandler('member', refresh);
    const unregisterInvitation = registerDeltaHandler('invitation', refresh);
    return () => {
      active = false;
      unregisterMember();
      unregisterInvitation();
    };
  }, [router]);

  const inviteRoles = ORG_ROLES.filter((entry) => entry !== 'admin' || canInviteAdmins);
  const inviteRole = inviteRoles.includes(role) ? role : 'member';
  const inviteEnabled = canInvite && canDeliverInvites;

  function announce(token: string | undefined, sentTo: string): void {
    setNotice(
      token === undefined
        ? `Invite sent to ${sentTo}.`
        : `Invite for ${sentTo}: ${window.location.origin}/invite/${token}`,
    );
  }

  async function run(id: string, action: () => Promise<void>): Promise<void> {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function onInvite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setInviting(true);
    setError(null);
    setNotice(null);
    try {
      const created = await apiFetch('/api/invites', acknowledgedSchema, {
        method: 'POST',
        body: { email: email.trim(), role: inviteRole },
      });
      announce(created.token, email.trim());
      setEmail('');
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setInviting(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="font-medium text-lg text-text-strong">Members</h2>
        <p className="text-muted text-xs">
          {members.length} {members.length === 1 ? 'person' : 'people'} in this workspace.
        </p>
      </header>

      <ul className="flex flex-col rounded-lg border border-border">
        {members.map((member) => (
          <li
            key={member.memberId}
            className={cn(
              'flex flex-wrap items-center gap-3 border-border border-b px-3 py-2 last:border-b-0',
              rowHover,
            )}
          >
            <Avatar name={member.name} src={member.image} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-dense text-text">
                {member.name}
                {member.userId === currentUserId ? (
                  <span className="text-faint"> (you)</span>
                ) : null}
              </span>
              <span className="truncate text-2xs text-faint">{member.email}</span>
            </span>
            <RoleSelect
              label={`Role for ${member.name}`}
              value={member.role}
              roles={ORG_ROLES}
              disabled={!canManage || busyId === member.memberId}
              onChange={(next) =>
                run(member.memberId, async () => {
                  await apiFetch(`/api/members/${member.memberId}`, acknowledgedSchema, {
                    method: 'PATCH',
                    body: { role: next },
                  });
                })
              }
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={!canManage || busyId === member.memberId}
              onClick={() =>
                run(member.memberId, async () => {
                  await apiFetch(`/api/members/${member.memberId}`, acknowledgedSchema, {
                    method: 'DELETE',
                  });
                })
              }
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>

      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <header className="flex flex-col gap-1">
          <h3 className="font-medium text-dense text-text">Invite someone</h3>
          <p className="text-muted text-xs">
            {canDeliverInvites
              ? 'They get a link by email that expires in 14 days.'
              : 'Email invitations are unavailable. Ask the server operator to configure email delivery, then return here to invite teammates.'}
          </p>
        </header>

        <form onSubmit={onInvite} className="flex flex-wrap items-center gap-2">
          <fieldset disabled={!inviteEnabled || inviting} className="flex flex-wrap gap-2">
            <Input
              type="email"
              name="email"
              aria-label="Email address"
              placeholder="teammate@example.com"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-64"
            />
            <RoleSelect
              label="Invite role"
              value={inviteRole}
              roles={inviteRoles}
              disabled={!inviteEnabled || inviting}
              onChange={setRole}
            />
            <Button type="submit" variant="primary" size="sm" className="h-9">
              {inviting ? 'Sending' : 'Send invite'}
            </Button>
          </fieldset>
        </form>

        {error === null ? null : (
          <p role="alert" className="text-danger text-xs">
            {error}
          </p>
        )}
        {notice === null ? null : (
          <p role="status" className="break-all text-success text-xs">
            {notice}
          </p>
        )}

        <div className="flex flex-col gap-2 border-border border-t pt-3">
          <h4 className="font-medium text-muted text-xs">Pending invites</h4>
          {invites.length === 0 ? (
            <p className="text-faint text-xs">No pending invites.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-dense text-text">{invite.email}</span>
                    <Badge tone="neutral">{ROLE_LABELS[invite.role]}</Badge>
                  </span>
                  <span className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!inviteEnabled || busyId === invite.id}
                      onClick={() =>
                        run(invite.id, async () => {
                          const resent = await apiFetch(
                            `/api/invites/${invite.id}`,
                            acknowledgedSchema,
                            { method: 'PATCH' },
                          );
                          announce(resent.token, invite.email);
                        })
                      }
                    >
                      Resend
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!canInvite || busyId === invite.id}
                      onClick={() =>
                        run(invite.id, async () => {
                          await apiFetch(`/api/invites/${invite.id}`, acknowledgedSchema, {
                            method: 'DELETE',
                          });
                        })
                      }
                    >
                      Revoke
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </section>
  );
}

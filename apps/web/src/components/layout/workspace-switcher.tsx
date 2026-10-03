'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, LogOut, Plus, Settings, SunMoon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { z } from 'zod';
import { WorkspaceLogo } from '@/components/layout/workspace-logo.tsx';
import { Avatar } from '@/components/ui/avatar.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from '@/lib/api/client.ts';
import { authClient } from '@/lib/auth/client.ts';
import { cn } from '@/lib/cn.ts';
import { navRowHover } from '@/lib/interaction.ts';
import { NAV_ITEMS, type ShellUser, type ShellWorkspace } from '@/lib/navigation.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import { forgetPersistedCache } from '@/lib/query/persist.ts';

export const WORKSPACE_LANDING = '/today';

const workspaceListSchema = z.object({
  organizations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      logo: z.string().nullable(),
    }),
  ),
});

const switchedSchema = z.object({ organizationId: z.string() });

const SETTINGS_HREF = NAV_ITEMS.find((item) => item.id === 'settings')?.href ?? '/settings/members';

export interface WorkspaceSwitcherProps {
  readonly workspace: ShellWorkspace;
  readonly user: ShellUser;
  readonly collapsed: boolean;
  readonly touch?: boolean;
}

export function WorkspaceSwitcher({
  workspace,
  user,
  collapsed,
  touch = false,
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const listed = useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => apiFetch('/api/organizations', workspaceListSchema),
    enabled: open,
  });
  const workspaces: readonly ShellWorkspace[] = listed.data?.organizations ?? [workspace];

  const handleSignOut = () => {
    authClient
      .signOut()
      .then(async () => {
        await forgetPersistedCache();
        router.push('/login');
        router.refresh();
      })
      .catch((error: unknown) => {
        toast({ title: 'Could not sign out', description: messageOf(error), tone: 'danger' });
      });
  };

  const switchTo = async (target: ShellWorkspace): Promise<void> => {
    if (target.id === workspace.id || switching) return;
    setSwitching(true);
    try {
      await apiFetch('/api/organizations/active', switchedSchema, {
        method: 'POST',
        body: { organizationId: target.id },
      });
      window.location.assign(WORKSPACE_LANDING);
    } catch (error: unknown) {
      setSwitching(false);
      toast({
        title: 'Could not switch workspace',
        description: messageOf(error, 'Try again.'),
        tone: 'danger',
      });
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        data-testid="workspace-switcher"
        aria-label={collapsed ? workspace.name : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 text-left text-dense',
          navRowHover,
          touch ? 'h-11 gap-3 px-3' : 'h-9',
          collapsed && 'justify-center px-0',
        )}
      >
        <WorkspaceLogo name={workspace.name} logo={workspace.logo} size="md" />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 truncate font-medium text-text">{workspace.name}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        <div className="flex items-center gap-2 px-2 py-2">
          <Avatar name={user.name} src={user.image ?? null} size="md" />
          <div className="min-w-0">
            <p className="truncate font-medium text-dense text-text">{user.name}</p>
            <p className="truncate text-2xs text-faint">{user.email}</p>
          </div>
        </div>
        <DropdownMenuSeparator />

        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((option) => {
          const active = option.id === workspace.id;
          return (
            <DropdownMenuItem
              key={option.id}
              data-testid={`workspace-option-${option.slug}`}
              aria-current={active ? 'true' : undefined}
              disabled={switching}
              onSelect={() => {
                switchTo(option);
              }}
            >
              <WorkspaceLogo name={option.name} logo={option.logo} size="sm" />
              <span className="min-w-0 flex-1 truncate">{option.name}</span>
              {active ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuItem
          data-testid="create-workspace"
          onSelect={() => router.push('/onboarding')}
        >
          <Plus className="size-4" aria-hidden="true" />
          Create workspace
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="settings-link" onSelect={() => router.push(SETTINGS_HREF)}>
          <Settings className="size-4" aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          <SunMoon className="size-4" aria-hidden="true" />
          Toggle theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

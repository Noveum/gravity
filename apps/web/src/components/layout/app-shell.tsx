'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { CommandPalette } from '@/components/command-palette.tsx';
import { ShortcutsOverlay } from '@/components/shortcuts-overlay.tsx';
import { overlayClassName } from '@/components/ui/dialog.tsx';
import { useHotkey } from '@/lib/keyboard/index.ts';
import {
  breadcrumbsFor,
  NAV_ITEMS,
  type NavItem,
  type ShellUser,
  type ShellWorkspace,
} from '@/lib/navigation.ts';
import { WorkspaceRealtime } from '@/lib/realtime/provider.tsx';
import { DESKTOP_QUERY, useMediaQuery, WIDE_QUERY } from '@/lib/use-media-query.ts';
import { Sidebar } from './sidebar.tsx';
import { TopBar } from './top-bar.tsx';

export interface AppShellProps {
  readonly workspace: ShellWorkspace;
  readonly user: ShellUser;
  readonly realtimeUrl: string;
  readonly realtimeCursor: number;
  readonly children: ReactNode;
}

function NavChord({ item }: { readonly item: NavItem }) {
  const router = useRouter();
  useHotkey(item.chord, () => router.push(item.href), {
    label: `Go to ${item.label}`,
    section: 'Navigation',
  });
  return null;
}

export function AppShell({
  workspace,
  user,
  realtimeUrl,
  realtimeCursor,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const isDesktop = useMediaQuery(DESKTOP_QUERY, true);
  const isWide = useMediaQuery(WIDE_QUERY, true);
  const [collapsePreference, setCollapsePreference] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerPath, setDrawerPath] = useState(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const collapsed = collapsePreference ?? !isWide;
  const breadcrumbs = useMemo(() => breadcrumbsFor(pathname), [pathname]);

  const toggleSidebar = useCallback(() => {
    if (isDesktop) setCollapsePreference(!collapsed);
    else setDrawerOpen((value) => !value);
  }, [isDesktop, collapsed]);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);

  useHotkey('[', toggleSidebar, { label: 'Toggle sidebar', section: 'View' });
  useHotkey('?', openShortcuts, { label: 'Show keyboard shortcuts', section: 'General' });

  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  const sidebar = (touch: boolean, onNavigate: (() => void) | null) => (
    <Sidebar
      workspace={workspace}
      user={user}
      collapsed={!touch && collapsed}
      touch={touch}
      onToggleCollapsed={toggleSidebar}
      onOpenPalette={() => setPaletteOpen(true)}
      onNavigate={onNavigate}
    />
  );

  return (
    <WorkspaceRealtime
      url={realtimeUrl}
      userId={user.id}
      organizationId={workspace.id}
      initialCursor={realtimeCursor}
    >
      <div data-app-shell className="flex h-dvh w-full overflow-hidden bg-bg">
        {NAV_ITEMS.map((item) => (
          <NavChord key={item.id} item={item} />
        ))}

        <aside
          className={
            collapsed
              ? 'hidden w-[var(--sidebar-width-collapsed)] shrink-0 lg:block'
              : 'hidden w-[var(--sidebar-width)] shrink-0 lg:block'
          }
        >
          {sidebar(false, null)}
        </aside>

        <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className={`${overlayClassName} lg:hidden`} />
            <DialogPrimitive.Content
              aria-label="Navigation"
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-50 w-[min(20rem,88vw)] outline-none data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in sm:w-[min(17rem,80vw)] lg:hidden"
            >
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              {sidebar(true, () => setDrawerOpen(false))}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            breadcrumbs={breadcrumbs}
            onOpenDrawer={() => setDrawerOpen(true)}
            onOpenSearch={() => setPaletteOpen(true)}
          />
          <main className="min-h-0 w-full flex-1 overflow-y-auto">{children}</main>
        </div>

        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onShowShortcuts={openShortcuts}
        />
        <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      </div>
    </WorkspaceRealtime>
  );
}

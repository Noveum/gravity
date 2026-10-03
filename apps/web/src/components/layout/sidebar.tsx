'use client';

import { PanelLeft, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { ScrollArea } from '@/components/ui/scroll-area.tsx';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';
import {
  NAV_ITEMS,
  type NavItem as NavItemData,
  type ShellUser,
  type ShellWorkspace,
} from '@/lib/navigation.ts';
import { NavItem } from './nav-item.tsx';
import { SidebarBrands } from './sidebar-brands.tsx';
import { SidebarSection } from './sidebar-section.tsx';
import { SidebarViews } from './sidebar-views.tsx';
import { WorkspaceSwitcher } from './workspace-switcher.tsx';

export interface SidebarProps {
  readonly workspace: ShellWorkspace;
  readonly user: ShellUser;
  readonly collapsed: boolean;
  readonly touch?: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onOpenPalette: () => void;
  readonly onNavigate?: (() => void) | null;
}

const WORK_ITEMS = NAV_ITEMS.filter((item) => item.group === 'work');
const RECORD_ITEMS = NAV_ITEMS.filter((item) => item.group === 'records');
const SETTINGS_ITEMS = NAV_ITEMS.filter((item) => item.group === 'settings');

export function Sidebar({
  workspace,
  user,
  collapsed,
  touch = false,
  onToggleCollapsed,
  onOpenPalette,
  onNavigate = null,
}: SidebarProps) {
  const toggle = (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggleCollapsed}
      aria-label={touch ? 'Close navigation' : 'Toggle sidebar'}
      className={cn('shrink-0 px-0', touch ? 'size-11' : 'size-7')}
    >
      {touch ? (
        <X className="size-5" aria-hidden="true" />
      ) : (
        <PanelLeft className="size-4" aria-hidden="true" />
      )}
    </Button>
  );

  const renderItem = (item: NavItemData) => (
    <NavItem
      key={item.id}
      item={item}
      collapsed={collapsed}
      touch={touch}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="flex h-full flex-col gap-1 border-border border-r bg-surface">
      <div className={cn('flex items-center gap-1 p-2', collapsed && 'flex-col')}>
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher
            workspace={workspace}
            user={user}
            collapsed={collapsed}
            touch={touch}
          />
        </div>
        {touch ? (
          toggle
        ) : (
          <Tooltip label="Toggle sidebar" shortcut={['[']} side="bottom">
            {toggle}
          </Tooltip>
        )}
      </div>

      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Search"
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-dense text-faint',
            cardHover,
            touch ? 'h-11' : 'h-7',
            collapsed && 'justify-center px-0',
          )}
        >
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          {collapsed ? null : (
            <>
              <span className="flex-1 text-left">Search</span>
              {touch ? null : <Kbd keys={['mod', 'k']} />}
            </>
          )}
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Workspace" className="flex flex-col gap-3 px-2 pb-4">
          {collapsed ? (
            <div className="flex flex-col items-stretch gap-0.5">
              {WORK_ITEMS.map(renderItem)}
              <div data-sidebar-separator className="my-1 h-px bg-border" aria-hidden="true" />
              {RECORD_ITEMS.map(renderItem)}
              <SidebarBrands collapsed touch={touch} onNavigate={onNavigate} />
            </div>
          ) : (
            <>
              <SidebarSection title="Work">{WORK_ITEMS.map(renderItem)}</SidebarSection>
              <SidebarSection title="Records">{RECORD_ITEMS.map(renderItem)}</SidebarSection>
              <SidebarBrands collapsed={false} touch={touch} onNavigate={onNavigate} />
              <SidebarViews collapsed={false} touch={touch} onNavigate={onNavigate} />
            </>
          )}
        </nav>
      </ScrollArea>

      <div className="flex flex-col gap-0.5 border-border border-t p-2">
        {SETTINGS_ITEMS.map(renderItem)}
      </div>
    </div>
  );
}

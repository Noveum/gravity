'use client';

import { Command } from 'cmdk';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, CircleHelp, Palette, PanelRight, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { COPY_LINK_BINDING } from '@/lib/copy-link.tsx';
import { formatBinding, useHotkey } from '@/lib/keyboard/index.ts';
import { NAV_ITEMS } from '@/lib/navigation.ts';

const PALETTE_BINDING = 'mod+k';

export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly shortcut?: string;
  readonly run: () => void;
}

export interface PaletteActions {
  readonly toggleTheme?: () => void;
  readonly showShortcuts?: () => void;
  readonly toggleContextPanel?: (() => void) | undefined;
  readonly copyLink?: (() => void) | undefined;
}

function optionalCommand(
  run: (() => void) | undefined,
  command: Omit<PaletteCommand, 'run'>,
): PaletteCommand[] {
  return run === undefined ? [] : [{ ...command, run }];
}

export function paletteCommands(
  navigate: (href: string) => void,
  actions: PaletteActions = {},
): PaletteCommand[] {
  return [
    ...NAV_ITEMS.map((item) => ({
      id: `go-${item.id}`,
      label: `Go to ${item.label}`,
      group: 'Navigate',
      shortcut: item.chord,
      run: () => navigate(item.href),
    })),
    ...optionalCommand(actions.toggleContextPanel, {
      id: 'toggle-context-panel',
      label: 'Toggle context panel',
      group: 'View',
      shortcut: ']',
    }),
    ...optionalCommand(actions.copyLink, {
      id: 'copy-link',
      label: 'Copy link',
      group: 'View',
      shortcut: COPY_LINK_BINDING,
    }),
    {
      id: 'toggle-theme',
      label: 'Toggle light and dark theme',
      group: 'Preferences',
      run: () => actions.toggleTheme?.(),
    },
    {
      id: 'show-shortcuts',
      label: 'Show keyboard shortcuts',
      group: 'Help',
      shortcut: '?',
      run: () => actions.showShortcuts?.(),
    },
  ];
}

const GROUP_ICONS: Readonly<Record<string, LucideIcon>> = {
  Navigate: ArrowRight,
  View: PanelRight,
  Preferences: Palette,
  Help: CircleHelp,
};

const itemClassName =
  'flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-dense text-muted outline-none data-[selected=true]:bg-surface-2 data-[selected=true]:text-text data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50';

const groupClassName =
  '[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:text-faint [&_[cmdk-group-heading]]:uppercase';

function groupedByName(commands: readonly PaletteCommand[]): [string, PaletteCommand[]][] {
  const groups = new Map<string, PaletteCommand[]>();
  for (const command of commands) {
    const members = groups.get(command.group) ?? [];
    members.push(command);
    groups.set(command.group, members);
  }
  return [...groups];
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onShowShortcuts: () => void;
  readonly onToggleContextPanel?: (() => void) | undefined;
  readonly onCopyLink?: (() => void) | undefined;
}

export function CommandPalette({
  open,
  onOpenChange,
  onShowShortcuts,
  onToggleContextPanel,
  onCopyLink,
}: CommandPaletteProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [term, setTerm] = useState('');

  const groups = useMemo(
    () =>
      groupedByName(
        paletteCommands((href) => router.push(href), {
          toggleTheme: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
          showShortcuts: onShowShortcuts,
          toggleContextPanel: onToggleContextPanel,
          copyLink: onCopyLink,
        }),
      ),
    [router, setTheme, resolvedTheme, onShowShortcuts, onToggleContextPanel, onCopyLink],
  );

  useHotkey(PALETTE_BINDING, () => onOpenChange(true), {
    label: 'Open command palette',
    section: 'General',
    allowInInput: true,
  });

  const run = (command: PaletteCommand) => {
    setTerm('');
    onOpenChange(false);
    command.run();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTerm('');
        onOpenChange(next);
      }}
    >
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        className="top-[12vh] max-w-xl translate-y-0 p-0"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command loop className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-border border-b px-3">
            <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
            <Command.Input
              autoFocus
              value={term}
              onValueChange={setTerm}
              placeholder="Type a command"
              className="h-11 w-full bg-transparent text-base text-text outline-none placeholder:text-faint"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-1.5">
            <Command.Empty className="px-2.5 py-6 text-center text-muted text-dense">
              Nothing matches that.
            </Command.Empty>
            {groups.map(([group, commands]) => {
              const Icon = GROUP_ICONS[group] ?? ArrowRight;
              return (
                <Command.Group key={group} heading={group} className={groupClassName}>
                  {commands.map((command) => (
                    <Command.Item
                      key={command.id}
                      value={`${group} ${command.label} ${command.shortcut ?? ''}`}
                      className={itemClassName}
                      onSelect={() => run(command)}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                      <span className="flex-1 truncate">{command.label}</span>
                      {command.shortcut === undefined ? null : (
                        <Kbd keys={formatBinding(command.shortcut)} />
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

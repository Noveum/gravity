'use client';

import { parseLeadKey } from '@gravity/shared/utils';
import { useQueryClient } from '@tanstack/react-query';
import { Command, defaultFilter } from 'cmdk';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Building2,
  CircleHelp,
  Palette,
  PanelRight,
  Search,
  Target,
  User,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { MAX_LIST_SEARCH_LENGTH } from '@/features/filters/list-query.ts';
import { personHref } from '@/features/leads/lead-groups.ts';
import { useCan } from '@/features/workspace/use-can.ts';
import { COPY_FOR_AGENT_BINDING } from '@/lib/copy-for-agent.tsx';
import { COPY_LINK_BINDING } from '@/lib/copy-link.tsx';
import { formatBinding, useHotkey } from '@/lib/keyboard/index.ts';
import { NAV_ITEMS } from '@/lib/navigation.ts';
import {
  EMPTY_HITS,
  HIT_LIMIT,
  mergeHits,
  personHitOf,
  searchCachedRecords,
} from '@/lib/query/record-search.ts';
import { useRecordSearch } from '@/lib/query/use-record-search.ts';

const PALETTE_BINDING = 'mod+k';
const RECORD_VALUE_PREFIX = 'record-';

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
  readonly copyForAgent?: (() => void) | undefined;
  readonly canImport?: boolean;
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
    ...(actions.canImport === false
      ? []
      : [
          {
            id: 'import',
            label: 'Import a CSV or JSON file',
            group: 'Navigate',
            run: () => navigate('/import'),
          },
        ]),
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
    ...optionalCommand(actions.copyForAgent, {
      id: 'copy-for-agent',
      label: 'Copy for agent',
      group: 'View',
      shortcut: COPY_FOR_AGENT_BINDING,
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

function paletteFilter(value: string, search: string, keywords?: string[]): number {
  return value.startsWith(RECORD_VALUE_PREFIX) ? 1 : defaultFilter(value, search, keywords);
}

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
  readonly onCopyForAgent?: (() => void) | undefined;
}

export function CommandPalette({
  open,
  onOpenChange,
  onShowShortcuts,
  onToggleContextPanel,
  onCopyLink,
  onCopyForAgent,
}: CommandPaletteProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const client = useQueryClient();
  const canImport = useCan('import:run');
  const [term, setTerm] = useState('');
  const local = useMemo(
    () => (open ? searchCachedRecords(client, term) : EMPTY_HITS),
    [client, term, open],
  );
  const remote = useRecordSearch(open ? term : '');
  const people = mergeHits(local.people, (remote.data?.people ?? []).map(personHitOf), HIT_LIMIT);
  const companies = mergeHits(local.companies, remote.data?.companies ?? [], HIT_LIMIT);
  const leads = mergeHits(local.leads, remote.data?.leads ?? [], HIT_LIMIT);
  const leadKey = parseLeadKey(term);

  const groups = useMemo(
    () =>
      groupedByName(
        paletteCommands((href) => router.push(href), {
          toggleTheme: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
          showShortcuts: onShowShortcuts,
          toggleContextPanel: onToggleContextPanel,
          copyLink: onCopyLink,
          copyForAgent: onCopyForAgent,
          canImport,
        }),
      ),
    [
      router,
      canImport,
      setTheme,
      resolvedTheme,
      onShowShortcuts,
      onToggleContextPanel,
      onCopyLink,
      onCopyForAgent,
    ],
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

  const go = (href: string) => {
    setTerm('');
    onOpenChange(false);
    router.push(href);
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
        <Command loop filter={paletteFilter} className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-border border-b px-3">
            <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
            <Command.Input
              autoFocus
              value={term}
              onValueChange={setTerm}
              placeholder="Type a command or search"
              maxLength={MAX_LIST_SEARCH_LENGTH}
              className="h-11 w-full bg-transparent text-base text-text outline-none placeholder:text-faint"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-1.5">
            <Command.Empty className="px-2.5 py-6 text-center text-muted text-dense">
              Nothing matches that.
            </Command.Empty>
            {leadKey === null && people.length + companies.length + leads.length === 0 ? null : (
              <Command.Group heading="Records" className={groupClassName}>
                {leadKey === null ? null : (
                  <Command.Item
                    value={`${RECORD_VALUE_PREFIX}open-${leadKey.key}-${leadKey.number}`}
                    className={itemClassName}
                    onSelect={() => go(`/l/${leadKey.key}-${leadKey.number}`)}
                  >
                    <ArrowRight className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="flex-1 truncate">
                      Open {leadKey.key}-{leadKey.number}
                    </span>
                  </Command.Item>
                )}
                {people.map((person) => (
                  <Command.Item
                    key={person.id}
                    value={`${RECORD_VALUE_PREFIX}person-${person.id}`}
                    className={itemClassName}
                    onSelect={() => go(`/people/${person.id}`)}
                  >
                    <User className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="flex-1 truncate">{person.name}</span>
                    <span className="truncate text-faint text-xs">
                      {person.email ?? person.companyName ?? ''}
                    </span>
                  </Command.Item>
                ))}
                {companies.map((company) => (
                  <Command.Item
                    key={company.id}
                    value={`${RECORD_VALUE_PREFIX}company-${company.id}`}
                    className={itemClassName}
                    onSelect={() => go(`/companies/${company.id}`)}
                  >
                    <Building2 className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="flex-1 truncate">{company.name}</span>
                    <span className="truncate text-faint text-xs">
                      {company.primaryDomain ?? ''}
                    </span>
                  </Command.Item>
                ))}
                {leads.map((lead) => (
                  <Command.Item
                    key={lead.id}
                    value={`${RECORD_VALUE_PREFIX}lead-${lead.id}`}
                    className={itemClassName}
                    onSelect={() => go(personHref(lead))}
                  >
                    <Target className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="flex-1 truncate">
                      {lead.key} {lead.personName}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
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

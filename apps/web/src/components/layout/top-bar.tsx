'use client';

import { Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import { ThemeToggle } from '@/components/theme-toggle.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Kbd } from '@/components/ui/kbd.tsx';
import { cn } from '@/lib/cn.ts';
import { cardHover, tabHover } from '@/lib/interaction.ts';
import type { Breadcrumb } from '@/lib/navigation.ts';

export interface TopBarProps {
  readonly breadcrumbs: readonly Breadcrumb[];
  readonly onOpenDrawer: () => void;
  readonly onOpenSearch: () => void;
}

function SearchBox({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        aria-label="Search"
        aria-keyshortcuts="Meta+K Control+K"
        data-testid="top-bar-search"
        onClick={onOpen}
        className={cn(
          'hidden h-7 min-w-56 shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-2 text-left',
          'text-dense text-faint md:flex',
          cardHover,
        )}
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Search</span>
        <Kbd keys={['mod', 'k']} className="opacity-70" />
      </button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Search"
        data-testid="top-bar-search-compact"
        onClick={onOpen}
        className="size-7 shrink-0 px-0 md:hidden"
      >
        <Search className="size-4" aria-hidden="true" />
      </Button>
    </>
  );
}

export function TopBar({ breadcrumbs, onOpenDrawer, onOpenSearch }: TopBarProps) {
  return (
    <header className="shrink-0 border-border border-b bg-bg">
      <div className="flex h-12 w-full items-center gap-1 px-2 sm:gap-2 sm:px-3 lg:h-[var(--topbar-height)]">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open navigation"
          onClick={onOpenDrawer}
          className="size-11 shrink-0 px-0 lg:hidden"
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>

        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1.5 text-dense">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <Fragment key={crumb.label}>
                  {index > 0 ? (
                    <li aria-hidden="true" className="hidden text-faint sm:block">
                      /
                    </li>
                  ) : null}
                  <li className={cn('min-w-0 truncate', last ? 'block' : 'hidden sm:block')}>
                    {crumb.href === undefined ? (
                      <span className={last ? 'font-medium text-text' : 'text-muted'}>
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        href={crumb.href}
                        className={cn('block truncate rounded-xs text-muted', tabHover)}
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </nav>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <SearchBox onOpen={onOpenSearch} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

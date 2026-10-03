'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { cn } from '@/lib/cn.ts';
import { navRowHover } from '@/lib/interaction.ts';
import { formatBinding } from '@/lib/keyboard/index.ts';
import { isNavItemActive, type NavItem as NavItemData } from '@/lib/navigation.ts';
import { NAV_ICONS } from './nav-icons.ts';

export interface NavItemProps {
  readonly item: NavItemData;
  readonly collapsed: boolean;
  readonly touch: boolean;
  readonly onNavigate: (() => void) | null;
}

export function NavItem({ item, collapsed, touch, onNavigate }: NavItemProps) {
  const pathname = usePathname();
  const active = isNavItemActive(item, pathname);
  const Icon = NAV_ICONS[item.id];

  const anchor = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      {...(onNavigate === null ? {} : { onClick: onNavigate })}
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 text-dense',
        touch ? 'h-11 gap-3 px-3' : 'h-7',
        active ? 'bg-surface-2 font-medium text-text' : cn('text-muted', navRowHover),
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
    </Link>
  );

  if (touch) return anchor;

  return (
    <Tooltip label={item.label} side="right" shortcut={formatBinding(item.chord)}>
      {anchor}
    </Tooltip>
  );
}

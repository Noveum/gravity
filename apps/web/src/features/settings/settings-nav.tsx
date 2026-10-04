'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { cn } from '@/lib/cn.ts';
import { navRowHover } from '@/lib/interaction.ts';

const ITEMS = [
  { href: '/settings/members', label: 'Members' },
  { href: '/settings/brands', label: 'Brands' },
  { href: '/settings/fields', label: 'Custom fields' },
  { href: '/settings/mcp', label: 'MCP clients' },
] as const;

function NavLink({
  href,
  label,
  indent = false,
}: {
  readonly href: string;
  readonly label: string;
  readonly indent?: boolean;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-7 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-dense',
        indent && 'pl-6',
        active ? 'bg-surface-2 text-text' : cn('text-muted', navRowHover),
      )}
    >
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function SettingsNav() {
  const workspace = useWorkspace();
  return (
    <nav
      aria-label="Settings"
      className="flex shrink-0 flex-row items-center gap-0.5 overflow-x-auto border-border border-b px-3 py-2 min-[900px]:w-56 min-[900px]:flex-col min-[900px]:items-stretch min-[900px]:overflow-x-visible min-[900px]:border-r min-[900px]:border-b-0 min-[900px]:p-3"
    >
      {ITEMS.map((item) => (
        <div key={item.href} className="flex flex-col gap-0.5">
          <NavLink href={item.href} label={item.label} />
          {item.href === '/settings/brands'
            ? workspace.pipelines.map((pipeline) => (
                <div key={pipeline.id} className="hidden min-[900px]:block">
                  <NavLink
                    indent
                    href={`/settings/pipelines/${pipeline.id}`}
                    label={`${workspace.brandById.get(pipeline.brandId)?.name ?? ''} · ${pipeline.name}`}
                  />
                </div>
              ))
            : null}
        </div>
      ))}
    </nav>
  );
}

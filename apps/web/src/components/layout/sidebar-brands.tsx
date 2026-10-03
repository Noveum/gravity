'use client';

import type { BrandRow, PipelineRow } from '@gravity/shared/records';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tooltip } from '@/components/ui/tooltip.tsx';
import { BrandDot } from '@/features/workspace/brand-dot.tsx';
import { useWorkspace } from '@/features/workspace/use-workspace.ts';
import { cn } from '@/lib/cn.ts';
import { navRowHover } from '@/lib/interaction.ts';
import { leadsHref, pipelineKeyOf } from '@/lib/navigation.ts';
import { SidebarSection } from './sidebar-section.tsx';

export interface SidebarBrandsProps {
  readonly collapsed: boolean;
  readonly touch: boolean;
  readonly onNavigate: (() => void) | null;
}

function PipelineLink({
  pipeline,
  touch,
  onNavigate,
}: {
  readonly pipeline: PipelineRow;
  readonly touch: boolean;
  readonly onNavigate: (() => void) | null;
}) {
  const active = pipelineKeyOf(usePathname()) === pipeline.key;
  return (
    <Link
      href={leadsHref(pipeline.key)}
      aria-current={active ? 'page' : undefined}
      {...(onNavigate === null ? {} : { onClick: onNavigate })}
      className={cn(
        'flex items-center gap-2 rounded-md pr-2 pl-6 text-dense',
        touch ? 'h-11' : 'h-7',
        active ? 'bg-surface-2 font-medium text-text' : cn('text-muted', navRowHover),
      )}
    >
      <span className="min-w-0 flex-1 truncate">{pipeline.name}</span>
      <span className="font-mono text-2xs text-faint">{pipeline.key}</span>
    </Link>
  );
}

function BrandDotLink({
  brand,
  pipelines,
}: {
  readonly brand: BrandRow;
  readonly pipelines: readonly PipelineRow[];
}) {
  const current = pipelineKeyOf(usePathname());
  const first = pipelines[0];
  if (first === undefined) return null;
  const active = pipelines.some((pipeline) => pipeline.key === current);
  return (
    <Tooltip label={brand.name} side="right">
      <Link
        href={leadsHref(first.key)}
        aria-label={brand.name}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-7 items-center justify-center rounded-md',
          active ? 'bg-surface-2' : navRowHover,
        )}
      >
        <BrandDot color={brand.color} />
      </Link>
    </Tooltip>
  );
}

export function SidebarBrands({ collapsed, touch, onNavigate }: SidebarBrandsProps) {
  const workspace = useWorkspace();
  if (workspace.brands.length === 0) return null;

  if (collapsed) {
    const reachable = workspace.brands.filter(
      (brand) => workspace.pipelinesOf(brand.id).length > 0,
    );
    if (reachable.length === 0) return null;
    return (
      <>
        <div data-sidebar-separator className="my-1 h-px bg-border" aria-hidden="true" />
        {reachable.map((brand) => (
          <BrandDotLink key={brand.id} brand={brand} pipelines={workspace.pipelinesOf(brand.id)} />
        ))}
      </>
    );
  }

  return (
    <SidebarSection title="Brands">
      {workspace.brands.map((brand) => (
        <div key={brand.id} className="flex flex-col gap-0.5">
          <div
            className={cn(
              'flex items-center gap-2 px-2 text-dense text-muted',
              touch ? 'h-11' : 'h-7',
            )}
          >
            <BrandDot color={brand.color} />
            <span className="truncate">{brand.name}</span>
          </div>
          {workspace.pipelinesOf(brand.id).map((pipeline) => (
            <PipelineLink
              key={pipeline.id}
              pipeline={pipeline}
              touch={touch}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </SidebarSection>
  );
}

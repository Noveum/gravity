import type { BrandColor } from '@gravity/shared/constants';
import { cn } from '@/lib/cn.ts';
import { BRAND_COLOR_CLASS } from './brand-color.ts';

export function BrandDot({
  color,
  className,
}: {
  readonly color: BrandColor;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        BRAND_COLOR_CLASS[color],
        className,
      )}
    />
  );
}

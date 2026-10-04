'use client';

import { BRAND_COLORS, type BrandColor } from '@gravity/shared/constants';
import { BRAND_COLOR_CLASS } from '@/features/workspace/brand-color.ts';
import { cn } from '@/lib/cn.ts';
import { swatchLift } from '@/lib/interaction.ts';

export function ColorPicker({
  value,
  onChange,
}: {
  readonly value: BrandColor;
  readonly onChange: (color: BrandColor) => void;
}) {
  return (
    <fieldset className="flex min-w-0 items-center gap-1.5">
      <legend className="sr-only">Colour</legend>
      {BRAND_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={color === value}
          onClick={() => onChange(color)}
          className={cn(
            'size-5 rounded-full',
            BRAND_COLOR_CLASS[color],
            swatchLift,
            color === value && 'ring-2 ring-ring ring-offset-1 ring-offset-bg',
          )}
        />
      ))}
    </fieldset>
  );
}

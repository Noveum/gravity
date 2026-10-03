import type { BrandColor } from '@gravity/shared/constants';

export const BRAND_COLOR_CLASS: Readonly<Record<BrandColor, string>> = {
  blue: 'bg-accent',
  green: 'bg-success',
  amber: 'bg-warning',
  red: 'bg-danger',
  violet: 'bg-merged',
  cyan: 'bg-accent',
  orange: 'bg-state-triage',
  gray: 'bg-faint',
};

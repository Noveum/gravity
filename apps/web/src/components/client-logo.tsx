'use client';

import { isAllowedLogoUri } from '@gravity/shared/utils';
import { useState } from 'react';
import { cn } from '@/lib/cn.ts';

type ClientLogoSize = 'sm' | 'md';

const SIZE_PIXELS: Record<ClientLogoSize, number> = { sm: 20, md: 36 };

const SIZE_CLASS: Record<ClientLogoSize, string> = {
  sm: 'size-5 rounded-sm text-2xs',
  md: 'size-9 rounded-md text-dense',
};

export function ClientLogo({
  name,
  src,
  size = 'md',
}: {
  readonly name: string;
  readonly src: string | null;
  readonly size?: ClientLogoSize;
}) {
  const [failed, setFailed] = useState(false);
  if (src === null || failed || !isAllowedLogoUri(src)) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center border border-border bg-surface-2 font-medium text-muted',
          SIZE_CLASS[size],
        )}
      >
        {Array.from(name.trim())[0]?.toUpperCase() ?? '?'}
      </span>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: a client logo on a third-party host must not go through the image optimizer
    <img
      data-testid="client-logo"
      src={src}
      alt=""
      width={SIZE_PIXELS[size]}
      height={SIZE_PIXELS[size]}
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn('shrink-0 border border-border bg-surface-2 object-contain', SIZE_CLASS[size])}
    />
  );
}

'use client';

import { SettingsGate } from '@/features/settings/settings-gate.tsx';
import { useMediaQuery } from '@/lib/use-media-query.ts';
import { ImportView, type ImportViewProps } from './import-view.tsx';

const WIDE_ENOUGH = '(min-width: 900px)';

export function ImportScreen(props: ImportViewProps) {
  const wide = useMediaQuery(WIDE_ENOUGH, true);
  return (
    <div className="min-w-0 flex-1 overflow-y-auto">
      {wide ? (
        <SettingsGate title="Could not load the workspace">
          <ImportView {...props} />
        </SettingsGate>
      ) : (
        <p className="p-4 text-dense text-muted">
          Imports are available on screens 900 pixels wide and larger.
        </p>
      )}
    </div>
  );
}

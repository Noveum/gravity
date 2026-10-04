import type { ReactNode } from 'react';
import { SettingsContent } from '@/features/settings/settings-content.tsx';
import { SettingsNav } from '@/features/settings/settings-nav.tsx';

export default function SettingsLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col min-[900px]:h-full min-[900px]:flex-row">
      <SettingsNav />
      <SettingsContent>{children}</SettingsContent>
    </div>
  );
}

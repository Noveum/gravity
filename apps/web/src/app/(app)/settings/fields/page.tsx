import type { Metadata } from 'next';
import { FieldsPanel } from '@/features/settings/fields-panel.tsx';

export const metadata: Metadata = { title: 'Custom fields' };

export default function FieldsSettingsPage() {
  return <FieldsPanel />;
}

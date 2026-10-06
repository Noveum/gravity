import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  CalendarCheck,
  CalendarClock,
  FolderOpen,
  Handshake,
  Inbox,
  ListOrdered,
  Settings,
  Target,
  Users,
} from 'lucide-react';
import type { NavSection } from '@/lib/navigation.ts';

export const NAV_ICONS: Readonly<Record<NavSection, LucideIcon>> = {
  today: CalendarCheck,
  inbox: Inbox,
  meetings: CalendarClock,
  leads: Target,
  people: Users,
  companies: Building2,
  deals: Handshake,
  sequences: ListOrdered,
  files: FolderOpen,
  settings: Settings,
};

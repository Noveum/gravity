import type { View } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import {
  Building2,
  CalendarDays,
  FolderOpen,
  GitBranch,
  Layers,
  ListChecks,
  type LucideIcon,
  Plug,
  Settings2,
  Users,
} from "lucide-react";

export const viewIcons: Record<View, LucideIcon> = {
  actions: ListChecks,
  people: Users,
  companies: Building2,
  sequences: GitBranch,
  meetings: CalendarDays,
  opportunities: Layers,
  materials: FolderOpen,
  integrations: Plug,
  settings: Settings2,
};

export const viewSections: { id: string; title: string; views: View[] }[] = [
  { id: "work", title: t.navWork, views: ["actions", "meetings"] },
  { id: "outreach", title: t.navOutreach, views: ["sequences"] },
  {
    id: "records",
    title: t.navRecords,
    views: ["people", "companies", "opportunities", "materials"],
  },
];
export const pinnedViews: View[] = ["integrations", "settings"];
export const listedViews: View[] = [
  ...viewSections.flatMap((section) => section.views),
  ...pinnedViews,
];

export interface Crumb {
  id: string;
  label: string;
  heading?: boolean;
}

export function breadcrumbsFor({
  workspace,
  product,
  view,
  record,
}: {
  workspace?: string;
  product?: string;
  view: string;
  record?: string;
}): Crumb[] {
  return [
    ...(workspace ? [{ id: "workspace", label: workspace }] : []),
    ...(product ? [{ id: "product", label: product }] : []),
    { id: "view", label: view, heading: true },
    ...(record ? [{ id: "record", label: record }] : []),
  ];
}

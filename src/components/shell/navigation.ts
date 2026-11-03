import { bindingLabel, shortcuts } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import {
  Bot,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  FolderOpen,
  GitBranch,
  Layers,
  ListChecks,
  type LucideIcon,
  Plug,
  Send,
  Settings2,
  Users,
} from "lucide-react";
import type { Section } from "../routes";

export const viewIcons: Record<Section, LucideIcon> = {
  overview: ChartNoAxesCombined,
  actions: ListChecks,
  people: Users,
  companies: Building2,
  sequences: GitBranch,
  meetings: CalendarDays,
  opportunities: Layers,
  materials: FolderOpen,
  outreach: Send,
  integrations: Plug,
  assistants: Bot,
  settings: Settings2,
};

export const viewSections: { id: string; title: string; views: Section[] }[] = [
  {
    id: "work",
    title: t.navWork,
    views: ["overview", "opportunities", "actions", "meetings"],
  },
  { id: "outreach", title: t.navOutreach, views: ["outreach", "sequences"] },
  {
    id: "records",
    title: t.navRecords,
    views: ["people", "companies", "materials"],
  },
];
export const pinnedViews: Section[] = [
  "assistants",
  "integrations",
  "settings",
];
export const listedViews: Section[] = [
  ...viewSections.flatMap((section) => section.views),
  ...pinnedViews,
];

export interface Crumb {
  id: string;
  label: string;
  heading?: boolean;
  href?: string;
}

export function breadcrumbsFor({
  workspace,
  product,
  view,
  viewHref,
  record,
}: {
  workspace?: string;
  product?: string;
  view: string;
  viewHref?: string;
  record?: string;
}): Crumb[] {
  return [
    ...(workspace ? [{ id: "workspace", label: workspace }] : []),
    ...(product && product !== workspace
      ? [{ id: "product", label: product }]
      : []),
    {
      id: "view",
      label: view,
      heading: true,
      ...(viewHref ? { href: viewHref } : {}),
    },
    ...(record ? [{ id: "record", label: record }] : []),
  ];
}

export const sectionHint = (section: Section) => {
  const binding = shortcuts.find((entry) => entry.view === section)
    ?.bindings[0];
  return binding ? bindingLabel(binding, false) : "";
};

export const sectionShortcut = (section: Section) =>
  shortcuts.find((entry) => entry.view === section)?.id;

"use client";
import { shortcutLabel } from "@crm/core/shortcuts";
import t from "@crm/i18n/translations/en.json";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import type { Organization } from "../client-api";
import {
  DropdownMenu,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from "../ui/dropdown-menu";
import { ShortcutHint } from "../ui/shortcut-hint";

export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
export function layerFor(trigger: HTMLElement | null) {
  return (
    trigger?.closest<HTMLElement>('dialog[open], [aria-modal="true"]') ??
    document.body
  );
}

export function WorkspaceMenu({
  organizations,
  organizationId,
  userName,
  userDetail,
  onSwitch,
}: {
  organizations: Organization[];
  organizationId: string;
  userName: string;
  userDetail: string;
  onSwitch: (id: string) => void;
}) {
  const name =
    organizations.find((org) => org.id === organizationId)?.name ?? t.workspace;
  return (
    <div className="workspace-menu">
      <DropdownMenu
        label={t.organizations}
        trigger={
          <button
            type="button"
            className="ghost workspace-trigger"
            data-workspace-trigger
            aria-label={`${t.switchOrganization}: ${name}`}
            title={`${name} (${shortcutLabel("organization")})`}
            aria-keyshortcuts="O"
          >
            <span className="workspace-logo" aria-hidden>
              {initials(name)}
            </span>
            <span className="workspace-name nav-label-text">{name}</span>
            <ShortcutHint id="organization" className="nav-label-text" />
            <ChevronsUpDown size={13} aria-hidden className="nav-label-text" />
          </button>
        }
      >
        <div className="menu-identity">
          <span className="avatar" aria-hidden>
            {initials(userName)}
          </span>
          <span>
            <span className="menu-identity-name">{userName}</span>
            <small>{userDetail}</small>
          </span>
        </div>
        <MenuSeparator className="menu-separator" />
        <MenuLabel className="menu-label">{t.organizations}</MenuLabel>
        <MenuRadioGroup
          value={organizationId}
          onValueChange={(id) => {
            if (id !== organizationId) onSwitch(id);
          }}
        >
          {organizations.map((org) => (
            <MenuRadioItem className="menu-item" value={org.id} key={org.id}>
              <span className="workspace-logo small" aria-hidden>
                {initials(org.name)}
              </span>
              <span className="menu-item-label">{org.name}</span>
              {org.id === organizationId && <Check size={13} aria-hidden />}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator className="menu-separator" />
        <MenuItem asChild>
          <a className="menu-item" href="/onboarding">
            <Plus size={14} aria-hidden />
            <span className="menu-item-label">{t.createWorkspace}</span>
            <ShortcutHint id="create-organization" />
          </a>
        </MenuItem>
      </DropdownMenu>
    </div>
  );
}

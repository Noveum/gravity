"use client";
import t from "@crm/i18n/translations/en.json";
import { ChevronsUpDown, Keyboard, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { browserNavigation, errorText, requestJson } from "../client-api";
import { sectionPath } from "../routes";
import { DropdownMenu, MenuItem, MenuSeparator } from "../ui/dropdown-menu";
import { initials } from "./workspace-menu";

export async function signOut(demo: boolean) {
  if (!demo)
    await requestJson("/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  browserNavigation.assign("/sign-in");
}
export function UserMenu({
  name,
  detail,
  demo,
  onShortcuts,
  onNavigate,
  onError,
}: {
  name: string;
  detail: string;
  demo: boolean;
  onShortcuts: () => void;
  onNavigate: () => void;
  onError: (message: string) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  return (
    <div className="user-menu-anchor">
      <DropdownMenu
        label={t.account}
        side="top"
        className="user-menu"
        trigger={
          <button
            type="button"
            className="ghost user-trigger"
            aria-label={`${t.account}: ${name}`}
            title={name}
          >
            <span className="avatar" aria-hidden>
              {initials(name)}
            </span>
            <span className="workspace-name nav-label-text">{name}</span>
            <ChevronsUpDown size={13} aria-hidden className="nav-label-text" />
          </button>
        }
      >
        <div className="menu-identity">
          <span className="avatar" aria-hidden>
            {initials(name)}
          </span>
          <span>
            <span className="menu-identity-name">{name}</span>
            <small>{detail}</small>
          </span>
        </div>
        <MenuSeparator className="menu-separator" />
        <MenuItem asChild>
          <Link
            className="menu-item"
            href={sectionPath("settings")}
            onClick={onNavigate}
          >
            <Settings size={14} aria-hidden />
            <span className="menu-item-label">{t.settings}</span>
          </Link>
        </MenuItem>
        <MenuItem className="menu-item" onSelect={onShortcuts}>
          <Keyboard size={14} aria-hidden />
          <span className="menu-item-label">{t.keyboardHelp}</span>
        </MenuItem>
        <MenuSeparator className="menu-separator" />
        <MenuItem
          className="menu-item"
          disabled={leaving}
          onSelect={async (event) => {
            event.preventDefault();
            setLeaving(true);
            try {
              await signOut(demo);
            } catch (error) {
              setLeaving(false);
              onError(errorText(error));
            }
          }}
        >
          <LogOut size={14} aria-hidden />
          <span className="menu-item-label">
            {leaving ? t.signingOut : t.signOut}
          </span>
        </MenuItem>
      </DropdownMenu>
    </div>
  );
}

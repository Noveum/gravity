"use client";
import t from "@crm/i18n/translations/en.json";
import { type FormEvent, useState } from "react";
import { useWorkspaceData } from "../crm/crm-context";
import { EmptyState } from "../ui/states";
import {
  AdminNotice,
  ConfirmButton,
  QueryState,
  SettingsGroup,
  SettingsPanel,
  useSettingsQuery,
} from "./settings-ui";

interface ContactRules {
  version: number;
  cooldownDays: number;
  dailyCapPerSender: number;
  quietHoursStart: number;
  quietHoursEnd: number;
}
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const outreachApi = "/api/outreach";

function RulesForm({
  rules,
  editable,
  onSave,
}: {
  rules: ContactRules;
  editable: boolean;
  onSave: (values: Omit<ContactRules, "version">) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const number = (key: string) => Number(values.get(key));
    setBusy(true);
    try {
      await onSave({
        cooldownDays: number("cooldownDays"),
        dailyCapPerSender: number("dailyCapPerSender"),
        quietHoursStart: number("quietHoursStart"),
        quietHoursEnd: number("quietHoursEnd"),
      });
    } finally {
      setBusy(false);
    }
  }
  const disabled = !editable || busy;
  return (
    <form className="settings-form" onSubmit={submit}>
      <label className="field">
        <span>{t.cooldownDays}</span>
        <input
          name="cooldownDays"
          type="number"
          min={0}
          max={365}
          required
          defaultValue={rules.cooldownDays}
          disabled={disabled}
        />
      </label>
      <label className="field">
        <span>{t.dailyCap}</span>
        <input
          name="dailyCapPerSender"
          type="number"
          min={1}
          max={10000}
          required
          defaultValue={rules.dailyCapPerSender}
          disabled={disabled}
        />
      </label>
      {(
        [
          ["quietHoursStart", t.quietHoursStart],
          ["quietHoursEnd", t.quietHoursEnd],
        ] as const
      ).map(([name, text]) => (
        <label className="field" key={name}>
          <span>{text}</span>
          <select name={name} defaultValue={rules[name]} disabled={disabled}>
            {hours.map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </label>
      ))}
      <p className="settings-note wide">{t.quietHoursHint}</p>
      <div className="settings-form-actions">
        {editable ? (
          <button type="submit" className="primary" disabled={busy}>
            {busy ? t.saving : t.save}
          </button>
        ) : (
          <AdminNotice />
        )}
      </div>
    </form>
  );
}

export function OutreachSettings() {
  const crm = useWorkspaceData();
  const organizationId = crm.organizationId;
  const query = useSettingsQuery<ContactRules>(
    `${outreachApi}?operation=rules&organizationId=${organizationId}`,
  );
  const people = [...crm.sourceData.people].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const blocked = people.filter((person) => person.doNotContact);
  const open = people.filter((person) => !person.doNotContact);
  const [choice, setChoice] = useState("");
  const company = (id: string | null) =>
    crm.sourceData.companies.find((item) => item.id === id)?.name ?? "";
  async function setContact(personId: string, doNotContact: boolean) {
    const person = people.find((item) => item.id === personId);
    if (!person) return false;
    const { ok } = await crm.send(
      {
        operation: "contact",
        organizationId,
        personId,
        version: person.version,
        doNotContact,
      },
      doNotContact ? t.markedDoNotContact : t.contactAllowed,
      true,
      outreachApi,
    );
    return ok;
  }
  return (
    <SettingsPanel section="outreach">
      <SettingsGroup title={t.contactRules}>
        <QueryState
          error={query.error}
          loading={query.loading}
          onRetry={() => void query.reload()}
          rows={2}
        />
        {query.data && (
          <RulesForm
            key={query.data.version}
            rules={query.data}
            editable={crm.isAdmin}
            onSave={async (values) => {
              if (!query.data) return;
              const { ok } = await crm.send(
                {
                  operation: "rules",
                  organizationId,
                  version: query.data.version,
                  ...values,
                },
                t.contactRulesSaved,
                true,
                outreachApi,
              );
              if (ok) await query.reload();
            }}
          />
        )}
      </SettingsGroup>
      <SettingsGroup title={t.doNotContact} detail={t.doNotContactDetail}>
        {blocked.length ? (
          <ul className="settings-list">
            {blocked.map((person) => (
              <li
                key={person.id}
                className="settings-row"
                aria-label={person.name}
              >
                <span className="settings-row-main">
                  <span>{person.name}</span>
                  <span className="settings-row-meta">
                    {company(person.companyId)}
                  </span>
                </span>
                <div className="settings-row-actions">
                  <ConfirmButton
                    label={t.allowContact}
                    confirmLabel={t.allowContactConfirm}
                    onConfirm={() => setContact(person.id, false)}
                  >
                    <span className="settings-row-meta">
                      {t.allowContactDetail}
                    </span>
                  </ConfirmButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t.doNotContactEmpty} compact />
        )}
        <form
          className="settings-inline-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (choice && (await setContact(choice, true))) setChoice("");
          }}
        >
          <select
            aria-label={t.choosePerson}
            value={choice}
            required
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">{t.choosePerson}</option>
            {open.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <button type="submit">{t.markDoNotContact}</button>
        </form>
      </SettingsGroup>
    </SettingsPanel>
  );
}

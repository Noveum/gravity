"use client";
import t from "@crm/i18n/translations/en.json";
import {
  AlarmClock,
  Check,
  Pencil,
  Send,
  SendHorizontal,
  SkipForward,
} from "lucide-react";
import type { Touch } from "./outreach-data";
import type { useTouchVerbs } from "./use-touch-verbs";

export function TouchActions({
  touch,
  verbs,
}: {
  touch: Touch;
  verbs: ReturnType<typeof useTouchVerbs>;
}) {
  const name = touch.person.name;
  const items = [
    {
      id: "edit",
      label: t.touchVerbs.edit,
      icon: Pencil,
      run: () => verbs.edit(touch),
    },
    ...(touch.status === "approved"
      ? []
      : [
          {
            id: "approve",
            label: t.touchVerbs.approve,
            icon: Check,
            run: () => verbs.approve(touch),
          },
        ]),
    ...(verbs.canSend(touch)
      ? [
          {
            id: "send",
            label: t.touchVerbs.send,
            icon: SendHorizontal,
            run: () => verbs.askSend(touch),
          },
        ]
      : []),
    {
      id: "sent",
      label: t.touchVerbs.sent,
      icon: Send,
      run: () => verbs.askSent(touch),
    },
    {
      id: "skip",
      label: t.touchVerbs.skip,
      icon: SkipForward,
      run: () => verbs.askSkip(touch),
    },
    {
      id: "snooze",
      label: t.touchVerbs.snooze,
      icon: AlarmClock,
      run: () => verbs.snooze(touch),
    },
  ];
  return items.map((item) => (
    <button
      key={item.id}
      type="button"
      tabIndex={-1}
      className="icon-button"
      aria-label={`${item.label}: ${name}`}
      title={item.label}
      onClick={item.run}
    >
      <item.icon size={13} aria-hidden />
    </button>
  ));
}

import { type ContactRules, earliestContact } from "./outreach-rules";

const day = 86400000;

export interface PlannerStep {
  number: number;
  delayDays: number;
  channel: "gmail" | "linkedin";
  template: string;
  followUp: number;
}

export interface PlannerTouch {
  stepNumber: number;
  status: "planned" | "drafted" | "approved" | "sent" | "skipped" | "expired";
  sentAt: number | null;
  closedAt: number | null;
}

export interface PlannerInput {
  now: number;
  enrollment: {
    status: "running" | "paused" | "completed" | "stopped";
    enrolledAt: number;
  };
  steps: readonly PlannerStep[];
  touches: readonly PlannerTouch[];
  doNotContact: boolean;
  timeZone: string;
  lastContactAt: number | null;
  rules: ContactRules;
}

export type PlannerDecision =
  | { kind: "wait" }
  | { kind: "create"; step: PlannerStep; dueAt: number }
  | { kind: "complete" }
  | { kind: "pause"; reason: "do_not_contact" };

const finished = new Set<PlannerTouch["status"]>([
  "sent",
  "skipped",
  "expired",
]);

export function planEnrollment(input: PlannerInput): PlannerDecision {
  if (input.enrollment.status !== "running") return { kind: "wait" };
  if (input.doNotContact) return { kind: "pause", reason: "do_not_contact" };
  const steps = [...input.steps].sort((a, b) => a.number - b.number);
  const byStep = new Map(
    input.touches.map((touch) => [touch.stepNumber, touch]),
  );
  let previous: PlannerTouch | undefined;
  for (const step of steps) {
    const touch = byStep.get(step.number);
    if (touch) {
      if (!finished.has(touch.status)) return { kind: "wait" };
      previous = touch;
      continue;
    }
    const readyAt = previous
      ? (previous.sentAt ?? previous.closedAt ?? input.now) +
        step.delayDays * day
      : input.enrollment.enrolledAt;
    if (input.now < readyAt) return { kind: "wait" };
    return {
      kind: "create",
      step,
      dueAt: earliestContact(readyAt, {
        timeZone: input.timeZone,
        lastContactAt: input.lastContactAt,
        rules: input.rules,
      }),
    };
  }
  return { kind: "complete" };
}

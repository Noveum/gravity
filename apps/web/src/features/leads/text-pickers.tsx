'use client';

import { type FormEvent, type KeyboardEvent, type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover.tsx';
import { type DateChoice, holdChoices, nextActionChoices } from './next-action-dates.ts';
import { returnFocusTo, useAnchor } from './verb-picker.tsx';

interface ShellProps {
  readonly open: boolean;
  readonly anchorId: string | null;
  readonly title: string;
  readonly notice?: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly children: ReactNode;
}

function PickerShell({
  open,
  anchorId,
  title,
  notice = null,
  onClose,
  onSubmit,
  children,
}: ShellProps) {
  const anchor = useAnchor(anchorId);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align="start"
        className="w-80"
        aria-label={title}
        onCloseAutoFocus={returnFocusTo(anchorId)}
      >
        <form className="flex flex-col gap-2" onSubmit={onSubmit}>
          {children}
          {notice === null ? null : <p className="text-warning text-xs">{notice}</p>}
        </form>
      </PopoverContent>
    </Popover>
  );
}

interface ChoicesProps {
  readonly choices: readonly DateChoice[];
  readonly value: string | null | undefined;
  readonly onChange: (at: string | null) => void;
}

function submitOnEnter(event: KeyboardEvent<HTMLButtonElement>): void {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function Choices({ choices, value, onChange }: ChoicesProps) {
  return (
    <fieldset className="flex flex-wrap gap-1">
      <legend className="sr-only">When</legend>
      {choices.map((choice) => (
        <Button
          key={choice.label}
          type="button"
          size="sm"
          variant={choice.at === value ? 'primary' : 'secondary'}
          aria-pressed={choice.at === value}
          onMouseDown={(event) => event.preventDefault()}
          onKeyDown={submitOnEnter}
          onClick={() => onChange(choice.at)}
        >
          {choice.label}
        </Button>
      ))}
    </fieldset>
  );
}

export interface NextActionValue {
  readonly nextAction: string | null;
  readonly nextActionAt?: string | null;
}

export interface NextActionPickerProps {
  readonly open: boolean;
  readonly anchorId: string | null;
  readonly initial: string;
  readonly notice?: string | null;
  readonly onSubmit: (value: NextActionValue) => void;
  readonly onClose: () => void;
}

export function NextActionPicker({
  open,
  anchorId,
  initial,
  notice = null,
  onSubmit,
  onClose,
}: NextActionPickerProps) {
  const [text, setText] = useState(initial);
  const [at, setAt] = useState<string | null | undefined>(undefined);
  const [choices] = useState(() => nextActionChoices(new Date()));
  return (
    <PickerShell
      open={open}
      anchorId={anchorId}
      title="Next action"
      notice={notice}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = text.trim();
        if (trimmed.length === 0) onSubmit({ nextAction: null, nextActionAt: null });
        else onSubmit({ nextAction: trimmed, ...(at === undefined ? {} : { nextActionAt: at }) });
      }}
    >
      <Input
        aria-label="Next action"
        placeholder="Send the intro"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Choices
        choices={choices}
        value={at}
        onChange={(next) => setAt((current) => (current === next ? undefined : next))}
      />
    </PickerShell>
  );
}

export interface HoldValue {
  readonly reason: string;
  readonly until: string | null;
}

export interface HoldPickerProps {
  readonly open: boolean;
  readonly anchorId: string | null;
  readonly notice?: string | null;
  readonly onSubmit: (value: HoldValue) => void;
  readonly onClose: () => void;
}

export function HoldPicker({ open, anchorId, notice = null, onSubmit, onClose }: HoldPickerProps) {
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState<string | null>(null);
  const [choices] = useState(() => holdChoices(new Date()));
  return (
    <PickerShell
      open={open}
      anchorId={anchorId}
      title="Hold with a reason"
      notice={notice}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = reason.trim();
        if (trimmed.length > 0) onSubmit({ reason: trimmed, until });
      }}
    >
      <Input
        aria-label="Reason"
        placeholder="Back in Q1"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <Choices choices={choices} value={until} onChange={setUntil} />
    </PickerShell>
  );
}

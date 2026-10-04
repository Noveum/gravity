'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input.tsx';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';

export type EditableFieldType = 'text' | 'email' | 'url' | 'number' | 'date';

export interface EditableFieldProps {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly type?: EditableFieldType;
  readonly required?: boolean;
  readonly inline?: boolean;
  readonly readOnly?: boolean;
  readonly onSave: (value: string) => void;
}

const NUMBER_PROBLEM = 'Enter a number.';

function problemWith(type: EditableFieldType, next: string): string | null {
  if (type !== 'number' || next === '') return null;
  return Number.isFinite(Number(next)) ? null : NUMBER_PROBLEM;
}

export function AttributeRow({
  label,
  children,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center gap-3 text-dense">
      <dt className="w-28 shrink-0 text-faint">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center">{children}</dd>
    </div>
  );
}

function Frame({
  inline,
  label,
  children,
}: {
  readonly inline: boolean;
  readonly label: ReactNode;
  readonly children: ReactNode;
}) {
  if (!inline) return <AttributeRow label={label}>{children}</AttributeRow>;
  return (
    <div className="flex min-w-0 flex-1 items-center">
      {label}
      {children}
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  placeholder = 'Empty',
  inline = false,
}: EditableFieldProps) {
  return (
    <Frame inline={inline} label={inline ? null : label}>
      <span
        className={cn(
          'min-w-0 flex-1 truncate px-1 leading-6',
          value === '' ? 'text-faint' : 'text-text',
        )}
      >
        {value === '' ? placeholder : value}
      </span>
    </Frame>
  );
}

export function EditableField(props: EditableFieldProps) {
  return props.readOnly === true ? <ReadOnlyField {...props} /> : <InlineEditor {...props} />;
}

function InlineEditor({
  label,
  value,
  placeholder = 'Empty',
  type = 'text',
  required = false,
  inline = false,
  onSave,
}: EditableFieldProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  const open = useRef(false);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
      return;
    }
    if (refocus.current) button.current?.focus();
    refocus.current = false;
  }, [editing]);

  const finish = (save: boolean, returnFocus: boolean) => {
    if (!open.current) return;
    const next = draft.trim();
    const refused = save ? problemWith(type, next) : null;
    if (refused !== null) {
      setProblem(refused);
      return;
    }
    open.current = false;
    refocus.current = returnFocus;
    setProblem(null);
    setEditing(false);
    if (save && next !== value && !(required && next.length === 0)) onSave(next);
  };

  if (!editing) {
    return (
      <Frame inline={inline} label={inline ? null : label}>
        <button
          ref={button}
          type="button"
          aria-label={`Edit ${label}`}
          onClick={() => {
            open.current = true;
            setDraft(value);
            setEditing(true);
          }}
          className={cn(
            'min-h-6 min-w-0 flex-1 truncate rounded-sm px-1 text-left',
            rowHover,
            value === '' ? 'text-faint' : 'text-text',
          )}
        >
          {value === '' ? placeholder : value}
        </button>
      </Frame>
    );
  }
  return (
    <Frame
      inline={inline}
      label={
        <label htmlFor={id} className={inline ? 'sr-only' : undefined}>
          {label}
        </label>
      }
    >
      <form
        className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5"
        onSubmit={(event) => {
          event.preventDefault();
          finish(true, true);
        }}
      >
        <Input
          id={id}
          ref={input}
          type={type === 'number' ? 'text' : type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          aria-invalid={problem === null ? undefined : true}
          aria-describedby={problem === null ? undefined : `${id}-problem`}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true, false)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            finish(false, true);
          }}
          className="h-6 px-1"
        />
        {problem === null ? null : (
          <p id={`${id}-problem`} className="text-2xs text-danger">
            {problem}
          </p>
        )}
      </form>
    </Frame>
  );
}

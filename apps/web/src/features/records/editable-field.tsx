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
  readonly onSave: (value: string) => void;
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

export function EditableField({
  label,
  value,
  placeholder = 'Empty',
  type = 'text',
  required = false,
  onSave,
}: EditableFieldProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
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
    open.current = false;
    refocus.current = returnFocus;
    setEditing(false);
    const next = draft.trim();
    if (save && draft !== value && !(required && next.length === 0)) onSave(draft);
  };

  if (!editing) {
    return (
      <AttributeRow label={label}>
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
      </AttributeRow>
    );
  }
  return (
    <AttributeRow label={<label htmlFor={id}>{label}</label>}>
      <form
        className="flex min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          finish(true, true);
        }}
      >
        <Input
          id={id}
          ref={input}
          type={type}
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
      </form>
    </AttributeRow>
  );
}

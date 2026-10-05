"use client";
import t from "@crm/i18n/translations/en.json";
import { KeyRound } from "lucide-react";
import { type Ref, useId, useState } from "react";

export function normalizeCode(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 6);
}

/** One accessible input preserves native keyboard, paste and OTP autofill. */
export function OneTimeCode({
  value,
  onChange,
  disabled,
  invalid,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  inputRef: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const [caret, setCaret] = useState(0);
  return (
    <div className="auth-code-field">
      <label htmlFor={id} className="auth-code-label">
        <KeyRound size={14} aria-hidden="true" />
        {t.signInCode}
      </label>
      <div
        className="auth-code-control"
        data-invalid={invalid}
        data-disabled={disabled}
      >
        <input
          ref={inputRef}
          id={id}
          value={value}
          onChange={(event) => {
            const next = normalizeCode(event.target.value);
            onChange(next);
            setCaret(Math.min(event.target.selectionStart ?? next.length, 5));
          }}
          onSelect={(event) =>
            setCaret(
              Math.min(event.currentTarget.selectionStart ?? value.length, 5),
            )
          }
          onPaste={(event) => {
            event.preventDefault();
            const next = normalizeCode(event.clipboardData.getData("text"));
            if (!next) return;
            onChange(next);
            setCaret(Math.min(next.length, 5));
          }}
          onPointerDown={(event) => {
            const input = event.currentTarget;
            const bounds = input.getBoundingClientRect();
            if (!bounds.width) return;
            const slot = Math.min(
              value.length,
              Math.max(
                0,
                Math.min(
                  5,
                  Math.floor(
                    ((event.clientX - bounds.left) / bounds.width) * 6,
                  ),
                ),
              ),
            );
            event.preventDefault();
            input.focus();
            input.setSelectionRange(slot, slot);
            setCaret(slot);
          }}
          type="text"
          required
          pattern="[0-9]{6}"
          maxLength={6}
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          aria-describedby="otp-instructions"
          aria-invalid={invalid || undefined}
          data-1p-ignore="true"
          data-lpignore="true"
          disabled={disabled}
        />
        <div className="auth-code-slots" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <span
              className="auth-code-slot"
              key={index}
              data-active={index === caret}
            >
              {value[index] ?? ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

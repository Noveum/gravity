import t from "@crm/i18n/translations/en.json";
import type { ButtonHTMLAttributes, InputHTMLAttributes } from "react";
export function Button({
  size: _size,
  variant,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: string;
  variant?: string;
}) {
  return (
    <button
      type="button"
      className={`${variant === "primary" ? "primary" : ""} ${className ?? ""}`}
      {...props}
    />
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}
export function messageOf(error: unknown, fallback = t.errors.NETWORK_ERROR) {
  return error instanceof Error ? error.message : fallback;
}

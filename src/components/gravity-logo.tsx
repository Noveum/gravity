import { gravityIdentity as identity } from "@crm/brand/identity";

/** Shared orbital G geometry, including static brand and app-icon exports. */
export function GravityMark({
  size = 32,
  className = "",
  color = "currentColor",
}: {
  size?: number;
  className?: string;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      className={`gravity-mark ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={identity.path}
        stroke={color}
        strokeWidth={identity.strokeWidth}
        strokeLinejoin="round"
      />
      <circle cx="64" cy="64" r={identity.coreRadius} fill={color} />
    </svg>
  );
}

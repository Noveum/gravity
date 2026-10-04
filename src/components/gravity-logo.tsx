/** Native vector counterpart of the generated orbital G concept. */
export function GravityMark({
  size = 32,
  className = "",
}: {
  size?: number;
  className?: string;
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
        d="M104.27 40.75A46.5 46.5 0 1 0 110.5 64H85"
        stroke="currentColor"
        strokeWidth="17"
        strokeLinejoin="round"
      />
      <circle cx="64" cy="64" r="15" fill="currentColor" />
    </svg>
  );
}

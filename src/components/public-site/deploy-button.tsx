import { siteCopy } from "@crm/public-site/content";
import { vercelDeployUrl } from "@crm/public-site/deployment";

export function DeployButton({ className = "" }: { className?: string }) {
  return (
    <a
      className={`site-button site-secondary ${className}`}
      href={vercelDeployUrl()}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M8 1 16 15H0Z" />
      </svg>
      {siteCopy.deployWithVercel}
    </a>
  );
}

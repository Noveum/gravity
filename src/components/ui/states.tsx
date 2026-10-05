import t from "@crm/i18n/translations/en.json";
import { CircleAlert, Inbox } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? " compact" : ""}`}>
      {!compact && (
        <span className="empty-state-icon">{icon ?? <Inbox />}</span>
      )}
      <div className="empty-state-copy">
        <h2 className="empty-state-title">{title}</h2>
        {description && (
          <p className="empty-state-description">{description}</p>
        )}
      </div>
      {action && <div className="empty-state-actions">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={<CircleAlert />}
      title={title}
      {...(description ? { description } : {})}
      action={
        onRetry && (
          <button type="button" onClick={onRetry}>
            {t.retry}
          </button>
        )
      }
    />
  );
}

const skeletonRows = [64, 82, 56, 74, 48, 68];

export function LoadingState({
  rows = skeletonRows.length,
  label = t.loading,
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="loading-state" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {skeletonRows.slice(0, rows).map((width) => (
        <div className="skeleton-row" key={width} aria-hidden>
          <span className="skeleton skeleton-dot" />
          <span className="skeleton" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}

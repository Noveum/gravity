function pastPhrase(seconds: number): string {
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

const DAY_MS = 86_400_000;

function calendarDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / DAY_MS);
}

function futurePhrase(seconds: number, from: Date, now: Date): string {
  if (seconds < 45) return 'in a moment';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const days = calendarDaysBetween(now, from);
  if (days === 0) return `in ${Math.round(minutes / 60)}h`;
  if (days === 1) return 'tomorrow';
  if (days < 7) return `in ${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `in ${weeks}w`;
  const months = Math.round(days / 30);
  if (months < 12) return `in ${months}mo`;
  return `in ${Math.round(days / 365)}y`;
}

export function relativeTime(from: Date, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - from.getTime()) / 1000);
  return seconds >= 0 ? pastPhrase(seconds) : futurePhrase(-seconds, from, now);
}

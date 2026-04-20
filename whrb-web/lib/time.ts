import { formatInTimeZone } from 'date-fns-tz';

export const TIMEZONE = 'America/New_York';

export function formatInTz(value: string | Date, fmt: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return formatInTimeZone(date, TIMEZONE, fmt);
}

export function formatDateTime(value: string | Date): string {
  return formatInTz(value, "MMM d, yyyy · h:mm a zzz");
}

export function formatDate(value: string | Date): string {
  return formatInTz(value, "MMM d, yyyy");
}

export function formatRelative(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604_800) return `${Math.floor(diffSec / 86_400)}d ago`;
  return formatDate(date);
}

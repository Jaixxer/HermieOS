import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combine class names with Tailwind merge.
 * `cn("p-2", "p-4")` → "p-4"
 * `cn("p-2", condition && "p-4")` → "p-2" or "p-4"
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a number with thousands separators. */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/** Format a relative time string ("3m ago", "in 2h"). `null`/`undefined` → "—". */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '—';
  const abs = Math.abs(ms);
  const future = ms > 0;
  const m = Math.floor(abs / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (abs < 60_000) return future ? 'in <1m' : 'just now';
  if (m < 60) return future ? `in ${m}m` : `${m}m ago`;
  if (h < 24) return future ? `in ${h}h` : `${h}h ago`;
  if (d < 30) return future ? `in ${d}d` : `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Truncate a string with ellipsis. */
export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

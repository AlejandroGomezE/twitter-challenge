import { format, formatDistanceToNowStrict } from 'date-fns';

// Compact counts, Pulse style: 999 → "999", 1200 → "1.2K", 1000 → "1K", 2_500_000 → "2.5M".
export function formatCount(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) < 1000) return String(n);
  // 999_950 would round to "1000K", so it switches to M there.
  if (Math.abs(n) < 999_950) return compact(n, 1000, 'K');
  return compact(n, 1_000_000, 'M');
}

const compact = (n, divisor, suffix) => `${(n / divisor).toFixed(1).replace(/\.0$/, '')}${suffix}`;

const SHORT_UNITS = {
  xSeconds: 's',
  xMinutes: 'm',
  xHours: 'h',
  xDays: 'd',
  xMonths: 'mo',
  xYears: 'y',
};

// A minimal date-fns locale that prints distances as "5s", "3m", "2h", "4d", "1mo", "2y".
const shortLocale = {
  formatDistance: (token, count) => `${count}${SHORT_UNITS[token] ?? ''}`,
};

// Short relative time for post cards ("3h").
export const formatRelativeShort = (date) =>
  formatDistanceToNowStrict(new Date(date), { locale: shortLocale });

// Full timestamp for titles and the post detail ("3:04 PM · Sep 24, 2026").
export const formatFullDate = (date) => format(new Date(date), 'h:mm a · MMM d, yyyy');

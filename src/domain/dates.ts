import { format } from 'date-fns';
import { es } from 'date-fns/locale';

/** Zona horaria de la app (Colombia, sin DST). */
export const APP_TZ = 'America/Bogota';

/** YYYY-MM-DD en la zona dada. */
export function todayLocal(now: Date = new Date(), tz: string = APP_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** HH:mm (24 h) en la zona dada. */
export function nowLocalTime(now: Date = new Date(), tz: string = APP_TZ): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

function parseParts(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) throw new Error(`Fecha inválida: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Calendar day number (days since epoch) via UTC noon, so DST/timezones can't shift it. */
export function dayNumber(date: string): number {
  const [y, m, d] = parseParts(date);
  return Math.round(Date.UTC(y, m - 1, d, 12) / 86_400_000);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parseParts(date);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

/** b − a in calendar days. */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** Inclusive range of dates. Empty if from > to. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** Monday of the ISO week containing `date`. */
export function isoWeekStart(date: string): string {
  const [y, m, d] = parseParts(date);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function formatDateEs(date: string, style: 'short' | 'long' | 'weekday' = 'short'): string {
  const [y, m, d] = parseParts(date);
  const local = new Date(y, m - 1, d, 12); // local noon: safe for any timezone
  const fmt = style === 'short' ? 'd MMM yyyy' : style === 'long' ? "EEEE, d 'de' MMMM 'de' yyyy" : 'EEE d MMM';
  return format(local, fmt, { locale: es });
}

import { ensure, freeze } from './errors.js';

export interface DateRange { readonly start: string; readonly end: string }

export function businessDate(value: string, field = 'date'): string {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'INVALID_DATE', 'Use a real calendar date in YYYY-MM-DD format.', field);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  ensure(year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= (lengths[month - 1] ?? 0), 'INVALID_DATE', 'Use a real calendar date.', field);
  return value;
}

export function dateRange(start: string, end: string): DateRange {
  businessDate(start, 'startDate');
  businessDate(end, 'endDate');
  ensure(end >= start, 'INVALID_PERIOD_RANGE', 'End date must be on or after start date.', 'endDate');
  return freeze({ start, end });
}

export function contains(range: DateRange, date: string): boolean {
  businessDate(date);
  return date >= range.start && date <= range.end;
}

/** Calendar-day offset in UTC; result is revalidated as a business date. */
export function addDays(date: string, days: number): string {
  businessDate(date);
  ensure(Number.isSafeInteger(days) && Math.abs(days) <= 36500, 'INVALID_DAYS', 'Day offset must be a bounded whole number.');
  const value = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + days));
  return businessDate(value.toISOString().slice(0, 10));
}

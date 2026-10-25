import { describe, expect, it } from 'vitest';
import { AccountingError, MAX_MINOR, MIN_MINOR, addAmounts, businessDate, currency, dateRange,
  formatAmount, minor, parseAmount, readMinor, roundRatio, writeMinor } from '../src/index.js';

describe('exact monetary arithmetic', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])('round-trips all signs and storage bounds at exponent %i', (scale) => {
    const unit = currency('USD', scale);
    for (const value of [0n, 1n, -1n, 9007199254740993n, -9007199254740993n, MIN_MINOR, MAX_MINOR]) {
      expect(parseAmount(formatAmount(value, unit), unit)).toBe(value);
      expect(readMinor(JSON.parse(JSON.stringify(writeMinor(value))) as string)).toBe(value);
    }
    for (let i = -100; i <= 100; i++) expect(parseAmount(formatAmount(BigInt(i * 137), unit), unit)).toBe(BigInt(i * 137));
  });
  it('adds beyond safe JS integer without losing a minor unit', () => {
    expect(addAmounts(9007199254740993n, 1n)).toBe(9007199254740994n);
    expect(parseAmount('0.10', currency('USD', 2)) + parseAmount('0.20', currency('USD', 2))).toBe(30n);
  });
  it.each(['01', '-0', '+1', '1e3', '1.0', ' 1', '', '1,000'])('rejects noncanonical integer %j', (value) => {
    expect(() => readMinor(value)).toThrow(AccountingError);
  });
  it.each(['01.00', '1e3', '+1', '.5', ' 1', 'NaN', '1,000', '', '1.'])('rejects malformed decimal %j', (value) => {
    expect(() => parseAmount(value, currency('USD', 2))).toThrow(AccountingError);
  });
  it('rejects implicit rounding, JS numbers and overflow', () => {
    expect(() => parseAmount('1.001', currency('USD', 2))).toThrow(expect.objectContaining({ code: 'EXCESS_PRECISION' }));
    expect(() => minor(1 as unknown as bigint)).toThrow(AccountingError);
    expect(() => minor(MAX_MINOR + 1n)).toThrow(AccountingError);
    expect(() => minor(MIN_MINOR - 1n)).toThrow(AccountingError);
    expect(() => addAmounts(MAX_MINOR, 1n)).toThrow(AccountingError);
    expect(() => readMinor('9'.repeat(100000))).toThrow(AccountingError);
  });
  it.each([-1, 1.1, 7, NaN])('rejects invalid exponent %j', (scale) => expect(() => currency('USD', scale)).toThrow(AccountingError));
  it.each(['usd', '', 'US', 'USDD'])('rejects currency %j', (code) => expect(() => currency(code, 2)).toThrow(AccountingError));
  it.each([
    [5n, 2n, 'half-even', 2n], [7n, 2n, 'half-even', 4n], [-5n, 2n, 'half-even', -2n],
    [5n, 2n, 'half-away', 3n], [-5n, 2n, 'half-away', -3n],
    [5n, 2n, 'toward-zero', 2n], [-5n, 2n, 'toward-zero', -2n],
  ] as const)('rounds %s / %s with explicit %s', (n, d, mode, expected) => expect(roundRatio(n, d, mode)).toBe(expected));
  it('rejects bad ratios and rounded overflow', () => {
    expect(() => roundRatio(1n, 0n, 'half-even')).toThrow(AccountingError);
    expect(() => roundRatio(1n, -1n, 'half-even')).toThrow(AccountingError);
    expect(() => roundRatio(MAX_MINOR * 2n, 1n, 'half-even')).toThrow(AccountingError);
  });
});

describe('calendar and REQ-PERIOD-RANGE-01', () => {
  it.each(['2026-01-01', '2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31'])('accepts real business date %s', (date) => expect(businessDate(date)).toBe(date));
  it.each(['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-01-00', '0000-01-01', '01-01-2026', '2026-1-1', '2026-01-01T00:00:00Z'])('rejects nonexistent/noncanonical date %s', (date) => expect(() => businessDate(date)).toThrow(AccountingError));
  it('returns a textual field-associated error for the exact owner-reported inverted range', () => {
    expect(() => dateRange('2026-02-28', '2026-02-01')).toThrow(expect.objectContaining({
      code: 'INVALID_PERIOD_RANGE', field: 'endDate', message: 'End date must be on or after start date.',
    }));
    expect(dateRange('2026-02-01', '2026-02-28')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(dateRange('2026-02-01', '2026-02-01').end).toBe('2026-02-01');
  });
});

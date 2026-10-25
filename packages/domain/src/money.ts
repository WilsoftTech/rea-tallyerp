import { ensure, freeze } from './errors.js';

export const MIN_MINOR = -(1n << 63n);
export const MAX_MINOR = (1n << 63n) - 1n;
export interface Currency { readonly code: string; readonly scale: number }

export function currency(code: string, scale: number): Currency {
  ensure(typeof code === 'string' && /^[A-Z]{3}$/.test(code), 'INVALID_CURRENCY', 'Currency requires a three-letter uppercase code.', 'currency.code');
  ensure(Number.isInteger(scale) && scale >= 0 && scale <= 6, 'INVALID_SCALE', 'Currency scale must be an integer from 0 to 6.', 'currency.scale');
  return freeze({ code, scale });
}

export function minor(value: bigint): bigint {
  ensure(typeof value === 'bigint', 'INVALID_AMOUNT', 'Money must use exact integer minor units.', 'amount');
  ensure(value >= MIN_MINOR && value <= MAX_MINOR, 'AMOUNT_OVERFLOW', 'Amount exceeds signed 64-bit storage bounds.', 'amount');
  return value;
}

export function readMinor(value: string): bigint {
  ensure(typeof value === 'string' && value.length <= 20 && /^(0|-?[1-9]\d*)$/.test(value), 'INVALID_AMOUNT', 'Expected a canonical base-10 integer string.', 'amount');
  return minor(BigInt(value));
}

export function writeMinor(value: bigint): string { return minor(value).toString(); }

export function parseAmount(text: string, unit: Currency): bigint {
  const valid = currency(unit.code, unit.scale);
  ensure(typeof text === 'string' && text.length <= 28 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(text), 'INVALID_AMOUNT', 'Enter a decimal amount without separators or exponent notation.', 'amount');
  const [whole = '', fraction = ''] = text.replace(/^-/, '').split('.');
  ensure(fraction.length <= valid.scale, 'EXCESS_PRECISION', 'Amount has more fractional digits than the currency permits.', 'amount');
  const magnitude = BigInt(whole) * 10n ** BigInt(valid.scale) + BigInt(fraction.padEnd(valid.scale, '0') || '0');
  return minor(text.startsWith('-') ? -magnitude : magnitude);
}

export function formatAmount(value: bigint, unit: Currency): string {
  minor(value);
  const { scale } = currency(unit.code, unit.scale);
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
  const number = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return `${value < 0n ? '-' : ''}${number}`;
}

export function addAmounts(...values: readonly bigint[]): bigint {
  return minor(values.reduce((sum, value) => sum + minor(value), 0n));
}

export type Rounding = 'toward-zero' | 'half-away' | 'half-even';
/** Exact rational intermediate; rounding is always explicit. No rate/tax policy implied. */
export function roundRatio(numerator: bigint, denominator: bigint, mode: Rounding): bigint {
  ensure(typeof numerator === 'bigint' && typeof denominator === 'bigint' && denominator > 0n, 'INVALID_RATIO', 'Use an integer numerator and positive integer denominator.');
  ensure(['toward-zero', 'half-away', 'half-even'].includes(mode), 'INVALID_ROUNDING', 'Select an explicit supported rounding policy.');
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const doubledRemainder = (magnitude % denominator) * 2n;
  if (mode !== 'toward-zero' && (doubledRemainder > denominator ||
    (doubledRemainder === denominator && (mode === 'half-away' || quotient % 2n !== 0n)))) quotient++;
  return minor(negative ? -quotient : quotient);
}

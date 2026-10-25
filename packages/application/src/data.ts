import { ensure } from '@erp/domain';

/** Exact deterministic payload, not a cryptographic digest or public wire API. */
export function canonical(value: unknown, ancestors = new Set<object>(), depth = 0): string {
  ensure(depth <= 32, 'INVALID_PAYLOAD', 'Command data nesting exceeds the supported bound.');
  if (typeof value === 'bigint') return `b:${value.toString()}`;
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return `${typeof value}:${JSON.stringify(value)}`;
  if (typeof value === 'number') {
    ensure(Number.isSafeInteger(value), 'INVALID_PAYLOAD', 'Numeric metadata must be a safe integer.');
    return `number:${value}`;
  }
  ensure(typeof value === 'object' && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype), 'INVALID_PAYLOAD', 'Commands must contain plain typed data.');
  ensure(!ancestors.has(value), 'INVALID_PAYLOAD', 'Command data cannot contain cycles.');
  ancestors.add(value);
  const result = Array.isArray(value)
    ? `[${value.map((item) => canonical(item, ancestors, depth + 1)).join(',')}]`
    : `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, ancestors, depth + 1)}`).join(',')}}`;
  ancestors.delete(value);
  return result;
}

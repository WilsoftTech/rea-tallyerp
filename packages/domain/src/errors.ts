export class AccountingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field: string | null = null,
  ) {
    super(message);
    this.name = 'AccountingError';
  }
}

export function ensure(condition: unknown, code: string, message: string, field: string | null = null): asserts condition {
  if (!condition) throw new AccountingError(code, message, field);
}

/** Freeze newly constructed snapshots; callers must copy external input first. */
export function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value !== null && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
}

export function identifier(value: string, field: string): string {
  ensure(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value), 'INVALID_ID', 'Use a nonempty bounded identifier.', field);
  return value;
}

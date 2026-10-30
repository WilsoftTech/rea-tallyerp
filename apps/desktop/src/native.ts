import { invoke } from '@tauri-apps/api/core';
import { AccountingError } from '@erp/domain';
import type { Native } from './store.js';
import type { Session } from '@erp/workspace/host';
export type { Session } from '@erp/workspace/host';
export function client(session: Session | null, onLocked: () => void): Native {
  return async <T>(operation: string, payload: Record<string, unknown> = {}): Promise<T> => {
    try {
      return await invoke<T>('accounting', { operation, payload: { ...payload, ...(session ? { token: session.token } : {}) } });
    } catch (error) {
      const data = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
      const code = typeof data.code === 'string' ? data.code : 'NATIVE_ERROR';
      if (code === 'SESSION_LOCKED') onLocked();
      throw new AccountingError(code, typeof data.message === 'string' ? data.message : 'Device operation failed. Your data has not been acknowledged as saved.',
        typeof data.field === 'string' ? data.field : null);
    }
  };
}

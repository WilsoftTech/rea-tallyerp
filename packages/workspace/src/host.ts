import type { Native } from './store.js';
export interface Session { token: string; tenantId: string; actorId: string; mode: 'local-only' }
export interface Host { platform: 'desktop' | 'browser'; createClient: (session: Session | null, onLocked: () => void) => Native; serviceOrigin?: string; subscribe?: (listener: () => void) => () => void; contextVersion?: () => string }
export const LOCAL_PERMISSIONS = ['read', 'post', 'reverse', 'draft', 'manage-chart', 'manage-periods', 'reopen-period'] as const;

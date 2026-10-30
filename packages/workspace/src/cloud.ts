import type { BookState } from '@erp/application';
import { decode, encode, operational } from '@erp/contracts/codec';
import type { Delivery } from '@erp/contracts/codec';
export interface CloudStatus {
  enrolled: boolean; session: { userId: string; endpoint: string; tenants: { id: string; role: string }[] } | null;
  endpoint?: string; remoteTenant?: string; remoteCompany?: string; cursor?: number;
  canonical?: unknown; paused?: string | null; expiresAt?: number | null;
  permissions?: string[]; authorityError?: { code: string; message: string } | null; commands?: Delivery[];
  intents?: { commandId: string; state: string; code: string | null }[];
  resolutions?: { originalCommand: string; compensation: string; replacement: string | null; root: string }[];
  pendingEnrollment?: { id: string; endpoint: string; remoteTenant: string; book: unknown } | null;
}
export function reportBook(local: BookState, status: CloudStatus | null, mode: string) {
  if (!status?.enrolled || mode === 'device') return { config: local.config, entries: local.entries, pending: 0, blocked: [] as string[] };
  const canonical = decode(encode(status.canonical));
  if (mode === 'canonical') return { config: canonical.config, entries: canonical.entries, pending: 0, blocked: [] as string[] };
  return operational(local, canonical, status.commands ?? []);
}

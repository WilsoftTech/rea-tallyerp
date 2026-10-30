import { ensure } from '@erp/domain';
import type { Scope } from '@erp/domain';
import { canonical, validateCommit } from '@erp/application';
import type { BookState } from '@erp/application';
import { remap } from './codec.js';
export { samePosting } from './codec.js';
export function preserveCanonical(old: BookState, next: BookState): void {
  for (const key of ['entries','receipts','audit'] as const) ensure(old[key].every((row,i) => next[key][i] !== undefined && canonical(row) === canonical(next[key][i])),
    'CANONICAL_HISTORY_CONFLICT', 'Accepted server history is missing or changed. Preserve backups and request recovery review.');
  ensure(canonical(old.config.company) === canonical(next.config.company), 'CANONICAL_HISTORY_CONFLICT', 'Accepted company identity changed unexpectedly.');
}
export function mergeMasters(source: BookState, cloud: BookState, cloudScope: Scope): BookState {
  const config = remap(cloud.config, cloudScope, source.config.company);
  ensure(canonical(source.config.company) === canonical(config.company), 'MASTER_CONFLICT', 'Shared company identity differs from this source book.');
  for (const key of ['years','periods','groups','ledgers'] as const) {
    for (const old of source.config[key]) {
      const next = config[key].find((row) => row.id === old.id);
      ensure(next, 'MASTER_CONFLICT', 'A source master is absent from the accepted snapshot.');
      const fields = key === 'years' ? ['start','end'] : key === 'periods' ? ['start','end','yearId'] : key === 'groups' ? ['parentId','nature'] : ['groupId','kind'];
      const a = old as unknown as Record<string,unknown>; const b = next as unknown as Record<string,unknown>;
      ensure(fields.every((field) => a[field] === b[field]), 'MASTER_CONFLICT', 'Shared classification/ranges changed; local history was preserved.');
    }
  }
  const next = { ...structuredClone(source), config, chartVersion: cloud.chartVersion };
  // Master refresh can advance several accepted revisions; validate the source
  // snapshot/history without treating it as a fabricated local financial command.
  validateCommit(structuredClone(next), next); return next;
}

import type { AccountingService } from './service.js';
import type { FinancialCommand, Principal } from './contracts.js';
export function dispatchCommand(service: AccountingService, principal: Principal, command: FinancialCommand): Promise<unknown> {
  switch (command.kind) {
    case 'post': return service.post(principal, command);
    case 'reverse': return service.reverse(principal, command);
    case 'save-draft': return service.saveDraft(principal, command);
    case 'post-draft': return service.postDraft(principal, command);
    case 'period-status': return service.setPeriodStatus(principal, command);
    case 'replace-chart': return service.replaceChart(principal, command);
    case 'extend-calendar': return service.extendCalendar(principal, command);
    case 'save-party': return service.saveParty(principal, command);
    case 'post-document': return service.postDocument(principal, command);
    case 'allocate': return service.allocate(principal, command);
    case 'void-document': return service.voidDocument(principal, command);
  }
}

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AccountingError, currency, dateRange, defineBook, ledgerStatement, parseAmount, trialBalance } from '@erp/domain';
import type { FinancialPeriod, JournalInput, Nature } from '@erp/domain';
import { AccountingService } from '@erp/application';
import type { BookState, FinancialCommand, Principal } from '@erp/application';
import { reportBook } from './cloud.js';
import type { CloudStatus } from './cloud.js';
import { LOCAL_PERMISSIONS } from './host.js';
import type { Host, Session } from './host.js';
import { ClientBookStore, encode, decode } from './store.js';
import type { Native } from './store.js';

const uid = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);
const permissions: Principal['permissions'] = LOCAL_PERMISSIONS;
function message(error: unknown): string { return error instanceof Error ? error.message : 'The operation could not be completed.'; }
function values(event: FormEvent<HTMLFormElement>): FormData { event.preventDefault(); return new FormData(event.currentTarget); }
const get = (data: FormData, name: string) => String(data.get(name) ?? '');
function Field({ name, label, type = 'text', value, error, ...props }: {
  name: string; label: string; type?: string; value?: string; error?: string;
  required?: boolean; minLength?: number; maxLength?: number; min?: number; max?: number; autoComplete?: string;
}) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>
    <input id={id} name={name} type={type} defaultValue={value} required
      aria-invalid={Boolean(error)} aria-describedby={error ? id + '-error' : undefined} {...props} />
    {error && <span className="field-error" id={id + '-error'} role="alert">{error}</span>}
  </div>;
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}
// Reports may legitimately exceed a single stored line's signed-64-bit bound.
function amount(value: bigint, scale: number): string {
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
  return (value < 0n ? '-' : '') + (scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits);
}
function errorFocus(error: unknown, fallback = 'endDate'): void {
  const field = error instanceof AccountingError && error.field && /^[A-Za-z0-9_.]+$/.test(error.field) ? error.field : fallback;
  document.querySelector<HTMLInputElement>(`input[name="${field.replaceAll('"', '')}"]`)?.focus();
}

export function App({ host }: { host: Host }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const native = useMemo(() => host.createClient(session, () => setSession(null)), [host, session]);
  useEffect(() => { native<{ initialized: boolean }>('status').then((r) => setInitialized(r.initialized)).catch((e: unknown) => setError(message(e))); }, [native]);
  useEffect(() => {if (session) return; return host.subscribe?.(() => {void native<{initialized:boolean}>('status').then(r=>setInitialized(r.initialized)).catch((e:unknown)=>setError(message(e)));});}, [host,native,session]);
  // Lock after inactivity in the renderer too; native enforces its own session timeout.
  useEffect(() => {
    if (!session) return;
    let timeout: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => { void native('lock'); setSession(null); }, 900_000);
    };
    reset(); window.addEventListener('keydown', reset); window.addEventListener('pointerdown', reset);
    return () => { clearTimeout(timeout); window.removeEventListener('keydown', reset); window.removeEventListener('pointerdown', reset); };
  }, [native, session]);
  if (session) return <Workspace host={host} session={session} lock={() => { void native('lock'); setSession(null); }} />;
  async function unlock(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget; const data = values(event);
    setBusy(true); setError('');
    try {
      const password = get(data, 'password');
      if (!initialized && password !== get(data, 'confirmPassword')) throw new Error('Passwords must match.');
      const result = await native<Session>(initialized ? 'unlock' : 'setup', { password });
      form.reset(); setSession(result);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <main className="unlock"><span className="eyebrow">Accounting workspace · device only</span>
    <h1>{initialized ? 'Unlock your workspace' : 'Set up this device'}</h1>
    <p>Work without an internet connection. Companies start on this device; connect selected companies to your service after review.</p>
    <p className="notice">{host.platform === 'browser' ? 'This browser stores local records without database encryption and may delete them. Private windows may erase them when closed. Keep encrypted backups outside the browser.' : 'The local database relies on your Windows account and device encryption for confidentiality.'} Exported backups use a separate encryption passphrase. Keep that passphrase safely; it cannot be recovered.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {initialized !== null && <form onSubmit={(e) => { void unlock(e); }}>
      <Field name="password" label="Device password" type="password" minLength={initialized ? 1 : 12} maxLength={1024} autoComplete={initialized ? 'current-password' : 'new-password'} />
      {!initialized && <Field name="confirmPassword" label="Confirm device password" type="password" minLength={12} maxLength={1024} autoComplete="new-password" />}
      <button disabled={busy}>{busy ? 'Opening…' : initialized ? 'Unlock' : 'Create device vault'}</button>
    </form>}
  </main>;
}

function CloudPanel({ native, cloud, book, busy, run, refresh, selected, choose, host }: {
  host: Host;
  native: Native; cloud: CloudStatus | null; book: BookState | null; busy: boolean;
  run: (work: () => Promise<void>, confirmation?: string) => Promise<void>; refresh: (selected?: string) => Promise<void>;
  selected: string; choose: (id: string) => void;
}) {
  const [tenant, setTenant] = useState(cloud?.session?.tenants[0]?.id ?? '');
  const [available, setAvailable] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {if (!tenant && cloud?.session?.tenants[0]) setTenant(cloud.session.tenants[0].id);}, [cloud, tenant]);
  const reviewed = cloud?.pendingEnrollment ? decode(encode(cloud.pendingEnrollment.book)) : book;
  const total = reviewed ? trialBalance(reviewed.config, reviewed.entries, '9999-12-31') : null;
  const action = (op: string, data: Record<string, unknown> = {}, confirmation?: string) => run(async () => {
    await native(op, { companyId: selected, ...data }); await refresh();
  }, confirmation);
  return <>
    <Panel title="Connect to your accounting service"><p>Cloud sessions stay in memory and clear when the workspace locks. Local-only companies remain independent. Remote services require HTTPS; local development permits loopback HTTP.</p>
      {cloud?.session ? <><p>Signed in to {cloud.session.endpoint} as account {cloud.session.userId}.</p><button disabled={busy} className="secondary" onClick={() => {void action('cloud_logout', {}, 'Signed out. Existing device records remain available.');}}>Sign out of service</button></> :
        <form onSubmit={(e) => {const form = e.currentTarget; const data = values(e); void run(async () => {
          const result = await native<{ tenants: { id: string }[] }>('cloud_login', { endpoint: get(data, 'endpoint'), username: get(data, 'username'), password: get(data, 'password') });
          form.reset(); setTenant(result.tenants[0]?.id ?? ''); await refresh();
        }, 'Service sign-in succeeded.');}}>
          {host.platform === 'browser' ? <><input type="hidden" name="endpoint" value={host.serviceOrigin} /><p>This browser connects to its configured accounting service.</p></> : <Field name="endpoint" label="Service origin" value={cloud?.endpoint ?? 'https://'} maxLength={1000} />}
          <Field name="username" label="Service username" autoComplete="username" maxLength={80} />
          <Field name="password" label="Service password" type="password" autoComplete="current-password" maxLength={1024} /><button disabled={busy}>Sign in to service</button>
        </form>}
    </Panel>
    {cloud?.session && <Panel title="Cloud companies"><label className="field">Cloud organization<select value={tenant} onChange={(e) => {setTenant(e.target.value); setAvailable([]);}}>{cloud.session.tenants.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.role}</option>)}</select></label>
      {book && !cloud.enrolled && <form onSubmit={(e) => {const data = values(e); void action('cloud_enroll', { remoteTenant: tenant, confirmed: data.get('confirmed') === 'on' }, 'Reviewed import accepted. New device work queues for server validation.');}}>
        <p>Enroll {reviewed?.config.company.name}: {reviewed?.entries.length} journals, {reviewed?.receipts.length} command receipts. Trial balance: debit {total?.debit.toString()}, credit {total?.credit.toString()} minor units. Historical import records an owner review; it does not attest the original actors' cloud authorization.</p>
        {cloud.pendingEnrollment && <p className="notice">Retrying original enrollment {cloud.pendingEnrollment.id} to {cloud.pendingEnrollment.endpoint}, organization {cloud.pendingEnrollment.remoteTenant}. Its reviewed snapshot is fixed; newer device journals queue after acceptance.</p>}
        <label className="check"><input required type="checkbox" name="confirmed" />I reviewed this synthetic or authorized company and its balances, made a backup, and approve importing its history into the selected organization.</label><button disabled={busy || !tenant}>Enroll selected company</button>
      </form>}
      {cloud.pendingEnrollment && <form onSubmit={(e) => {const data = values(e); void action('cloud_cancel_enrollment', { confirmed: data.get('confirmed') === 'on', reason: get(data, 'reason') }, 'Enrollment cancelled by the service. Company remains local-only.');}}>
        <Field name="reason" label="Reason for cancelling enrollment" maxLength={2000} /><label className="check"><input type="checkbox" name="confirmed" required />Cancel this pending import after the service confirms it was never accepted. Preserve all device records.</label><button disabled={busy} className="secondary">Cancel pending enrollment</button>
      </form>}
      <button className="secondary" disabled={busy || !tenant} onClick={() => {void run(async () => {setAvailable(await native('cloud_companies', { remoteTenant: tenant }));}, 'Available cloud companies loaded.');}}>Find existing cloud companies</button>
      {available.map((c) => <form key={c.id} onSubmit={(e) => {const data = values(e); void run(async () => {
        const result = await native<{ companyId: string }>('cloud_join', { remoteTenant: tenant, remoteCompany: c.id, confirmed: data.get('confirmed') === 'on' });
        choose(result.companyId); await refresh(result.companyId);
      }, 'Cloud company joined as a separate device book.');}}><p>{c.name}</p><label className="check"><input type="checkbox" name="confirmed" required />Join this company using its accepted cloud history, keeping existing device books separately.</label><button disabled={busy}>Join company</button></form>)}
    </Panel>}
    {cloud?.enrolled && <Panel title="Delivery and authority"><p>Cloud mirror cursor: {cloud.cursor}. {cloud.paused ? `Review required: ${cloud.paused}.` : 'No recorded delivery pause.'}</p>
      <p>Offline posting authority: {cloud.expiresAt ? 'expires ' + new Date(cloud.expiresAt * 1000).toLocaleString() : 'unavailable'}. Maximum duration after renewal is 24 hours. Roles: {cloud.permissions?.join(', ') || 'read/backup only'}.</p>
      {cloud.authorityError && <p role="alert" className="error">{cloud.authorityError.message}</p>}
      <button disabled={busy || !cloud.session} onClick={() => {void action('cloud_sync', {}, 'Synchronization completed. Inspect the individual command outcomes below.');}}>Synchronize now</button>
      <table aria-label="Command delivery"><thead><tr><th>Command</th><th>State</th><th>Detail</th></tr></thead><tbody>{cloud.commands?.map((c) => <tr key={c.commandId}><td>{c.commandId}</td><td>{c.localOnly ? 'Device compensation only' : c.state}</td><td>{c.code}{c.replaces && ` · replaces ${c.replaces}`}</td></tr>)}</tbody></table>
      {cloud.intents?.map((i) => <p key={i.commandId}>Master command {i.commandId}: {i.state} {i.code}{i.state === 'pending' && <button disabled={busy || !cloud.session} onClick={() => {void action('cloud_retry_master', { commandId: i.commandId }, 'Original master command reconciled.');}}>Retry original master command</button>}</p>)}
      <form onSubmit={(e) => {const data = values(e); void action('cloud_recover', { confirmed: data.get('confirmed') === 'on' }, 'Recovery snapshot and durable receipts reconciled.');}}>
        <p>After restoring a backup or a server generation change, sign in with the enrolled account. Recovery preserves local records and refuses a cloud history that has lost previously accepted evidence.</p>
        <label className="check"><input type="checkbox" name="confirmed" required />I preserved a current backup and approve reconciling this device's generation and accepted history.</label><button disabled={busy || !cloud.session} className="secondary">Reconcile recovery</button>
      </form>
    </Panel>}
  </>;
}

function Workspace({ session, lock, host }: { session: Session; lock: () => void; host: Host }) {
  const native = useMemo(() => host.createClient(session, lock), [host, session, lock]);
  const store = useMemo(() => new ClientBookStore(native), [native]);
  const service = useMemo(() => new AccountingService(store, () => new Date().toISOString()), [store]);
  const [companies, setCompanies] = useState<{ companyId: string; name: string }[]>([]);
  const [company, setCompany] = useState('');
  const [book, setBook] = useState<BookState | null>(null);
  const [yearId, setYearId] = useState('');
  const [view, setView] = useState('overview');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [rangeError, setRangeError] = useState('');
  const [reportRange, setReportRange] = useState({ start: today(), end: today() });
  const [ledgerId, setLedgerId] = useState('');
  const [lineCount, setLineCount] = useState(2);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [reportMode, setReportMode] = useState('operational');
  const [resolution, setResolution] = useState('');
  const selectedCompany = useRef(company); selectedCompany.current = company;
  const attempts = useRef(new Map<string, { commandId: string; entryId: string }>());
  const actor: Principal = { tenantId: session.tenantId, companyId: company, actorId: session.actorId, permissions };
  async function refresh(selected = company) {
    const context = host.contextVersion?.(); const isCurrent = () => selectedCompany.current === selected && host.contextVersion?.() === context;
    setCompanies(await native('list_books'));
    if (!isCurrent()) return;
    const status = await native<CloudStatus>('cloud_status', { companyId: selected });
    if (!isCurrent()) return; setCloud(status);
    if (!selected) return;
    const current = await store.read({ tenantId: session.tenantId, companyId: selected });
    if (selectedCompany.current !== selected || host.contextVersion?.() !== context) return;
    setBook(current);
    const year = current.config.years.find((y) => y.id === yearId) ?? current.config.years[0];
    setYearId(year?.id ?? '');
  }
  useEffect(() => { void refresh().catch((e: unknown) => setError(message(e))); }, [company, store]); // scope changes reload persisted data
  useEffect(() => host.subscribe?.(() => {void refresh().catch((e:unknown)=>setError(message(e)));}), [host,company,store,yearId]);
  useEffect(() => {
    if (!company || !cloud?.enrolled || !cloud.session) return;
    let cancelled = false; let running = false;
    const tick = async () => {
      if (running || cancelled || document.visibilityState !== 'visible' || !navigator.onLine) return;
      running = true;
      try {await native('cloud_sync', { companyId: company });}
      catch { /* Native retains retry timing, pause reason and the original command. */ }
      finally {
        if (!cancelled) {
          try {
            const [status, current] = await Promise.all([native<CloudStatus>('cloud_status', { companyId: company }), store.read({ tenantId: session.tenantId, companyId: company })]);
            if (!cancelled) {setCloud(status); setBook(current);}
          } catch { /* Device lock is handled by the native client. */ }
        }
        running = false;
      }
    };
    const timer = setInterval(() => {void tick();}, 30000);
    const online = () => {void tick();}; window.addEventListener('online', online);
    return () => {cancelled = true; clearInterval(timer); window.removeEventListener('online', online);};
  }, [company, cloud?.enrolled, cloud?.session?.userId, native, store, session.tenantId]);
  async function run(work: () => Promise<void>, confirmation = cloud?.enrolled ? 'Saved on this device. Check Synchronization for cloud acceptance.' : 'Saved on this device. Company is local-only.') {
    if (busy) return;
    setBusy(true); setError(''); setSuccess('');
    try { await work(); setSuccess(confirmation); } catch (e) { setError(message(e)); errorFocus(e); } finally { setBusy(false); }
  }
  async function master(command: FinancialCommand) {
    if (cloud?.enrolled) return native('cloud_command', { companyId: company, command: JSON.parse(encode(command)) as unknown });
    switch (command.kind) {
      case 'replace-chart': return service.replaceChart(actor, command);
      case 'period-status': return service.setPeriodStatus(actor, command);
      case 'extend-calendar': return service.extendCalendar(actor, command);
      default: throw new Error('Unsupported shared master command.');
    }
  }
  function validRange(data: FormData) {
    setRangeError('');
    try { return dateRange(get(data, 'startDate'), get(data, 'endDate')); }
    catch (e) { setRangeError(message(e)); errorFocus(e); throw e; }
  }
  async function createCompany(event: FormEvent<HTMLFormElement>) {
    const data = values(event);
    await run(async () => {
      const range = validRange(data);
      const scope = { tenantId: session.tenantId, companyId: uid() };
      const fy = { ...scope, id: uid(), ...range };
      const natures: Nature[] = ['asset', 'liability', 'equity', 'income', 'expense'];
      const config = defineBook({
        company: { ...scope, name: get(data, 'name'), currency: currency(get(data, 'currency'), Number(get(data, 'scale'))), booksFrom: get(data, 'booksFrom') },
        years: [fy], periods: [{ ...scope, id: uid(), yearId: fy.id, ...range, status: 'open', version: 1 }],
        groups: natures.map((nature) => ({ ...scope, id: uid(), name: nature.charAt(0).toUpperCase() + nature.slice(1), nature, parentId: null })),
        ledgers: [],
      });
      await store.register(config); setCompany(scope.companyId); setView('chart'); await refresh(scope.companyId);
    });
  }
  async function addLedger(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget; const data = values(event);
    await run(async () => {
      if (!book) return;
      const kind = get(data, 'kind');
      if (kind !== 'general' && kind !== 'cash' && kind !== 'bank') throw new Error('Select a supported ledger kind.');
      await master({ kind: 'replace-chart', commandId: uid(), expectedChartVersion: book.chartVersion,
        groups: book.config.groups, ledgers: [...book.config.ledgers, { tenantId: actor.tenantId, companyId: actor.companyId, id: uid(), name: get(data, 'name'), groupId: get(data, 'groupId'), kind }] });
      form.reset(); await refresh();
    });
  }
  async function addGroup(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget; const data = values(event);
    await run(async () => {
      if (!book) return;
      const parent = book.config.groups.find((g) => g.id === get(data, 'parentId'));
      if (!parent) throw new Error('Choose a group.');
      await master({ kind: 'replace-chart', commandId: uid(), expectedChartVersion: book.chartVersion, ledgers: book.config.ledgers,
        groups: [...book.config.groups, { tenantId: actor.tenantId, companyId: actor.companyId, id: uid(), name: get(data, 'name'), nature: parent.nature, parentId: parent.id }] });
      form.reset(); await refresh();
    });
  }
  async function addYear(event: FormEvent<HTMLFormElement>) {
    const data = values(event);
    await run(async () => {
      if (!book) return;
      const range = validRange(data);
      const scope = { tenantId: actor.tenantId, companyId: actor.companyId };
      const year = { ...scope, id: uid(), ...range };
      await master({ kind: 'extend-calendar', commandId: uid(), expectedChartVersion: book.chartVersion,
        year, period: { ...scope, id: uid(), yearId: year.id, ...range, status: 'open', version: 1 }, reason: get(data, 'reason') });
      await refresh(); setYearId(year.id); setReportRange(range);
    });
  }
  async function journal(event: FormEvent<HTMLFormElement>, draft: boolean) {
    const form = event.currentTarget; const data = values(event);
    await run(async () => {
      if (!book) return;
      const p = book.config.periods.find((p) => p.id === get(data, 'periodId'));
      if (!p) throw new Error('Select a financial period.');
      const intent = get(data, 'intent') as JournalInput['intent'];
      const signature = JSON.stringify([company, draft, [...data.entries()]]);
      const attempt = attempts.current.get(signature) ?? { commandId: uid(), entryId: uid() };
      attempts.current.set(signature, attempt);
      const input: JournalInput = { tenantId: actor.tenantId, companyId: actor.companyId, id: attempt.entryId, date: get(data, 'date'), periodId: p.id, expectedPeriodVersion: p.version, intent,
        narration: get(data, 'narration'), lines: Array.from({ length: lineCount }, (_, i) => ({
          ledgerId: get(data, 'ledger' + i), side: get(data, 'side' + i) as 'debit' | 'credit',
          amount: parseAmount(get(data, 'amount' + i), book.config.company.currency),
        })) };
      if (draft) await service.saveDraft(actor, { kind: 'save-draft', commandId: attempt.commandId, expectedChartVersion: book.chartVersion, draft: input, expectedDraftVersion: null });
      else {
        const target = resolution ? new AccountingService(new ClientBookStore(native, { resolutionMode: 'replace', originalCommand: resolution }), () => new Date().toISOString()) : service;
        await target.post(actor, { kind: 'post', commandId: attempt.commandId, expectedChartVersion: book.chartVersion, journal: input });
        setResolution('');
      }
      attempts.current.delete(signature);
      form.reset(); await refresh();
    }, draft ? 'Draft saved on this device. It has no effect on balances.' : undefined);
  }
  async function reverse(event: FormEvent<HTMLFormElement>) {
    const data = values(event);
    await run(async () => {
      if (!book) return;
      const period = book.config.periods.find((p) => p.id === get(data, 'periodId'));
      if (!period) throw new Error('Select a financial period.');
      await service.reverse(actor, { kind: 'reverse', commandId: uid(), originalId: get(data, 'originalId'), expectedChartVersion: book.chartVersion,
        journal: { ...actor, id: uid(), date: get(data, 'date'), periodId: period.id, expectedPeriodVersion: period.version, narration: get(data, 'narration') } });
      await refresh();
    });
  }
  const periodOptions = (book?.config.periods ?? []).filter((p) => p.yearId === yearId);
  const periodSelect = <label className="field">Financial period<select name="periodId" required>{periodOptions.map((p) => <option key={p.id} value={p.id}>{p.start} to {p.end} · {p.status}</option>)}</select></label>;
  const year = book?.config.years.find((y) => y.id === yearId);
  const rangeFields = (start: string, end: string) => <div className="grid"><Field name="startDate" label="Start date" type="date" value={start} /><Field name="endDate" label="End date" type="date" value={end} error={rangeError} /></div>;
  function changeView(next: string) {setView(next); setError(''); setSuccess(''); setRangeError('');}
  async function backup(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget; const data = values(event);
    const restore = get(data, 'action') === 'restore';
    await run(async () => {
      const result = await native<{ completed: boolean }>(restore ? 'restore' : 'backup', { passphrase: get(data, 'passphrase'), confirmed: data.get('confirmed') === 'on' });
      if (!result.completed) throw new Error('File selection was cancelled. No backup or restore completed.');
      form.reset(); if (restore) lock();
    }, restore ? 'Backup restored. Unlock with the device password stored in that backup.' : host.platform === 'browser' ? 'Encrypted backup download started. Confirm it is saved outside this browser; keep its passphrase separately.' : 'Encrypted backup saved. Keep its passphrase separately.');
  }
  const scale = book?.config.company.currency.scale ?? 0;
  let report: ReturnType<typeof trialBalance> | null = null;
  let statement: ReturnType<typeof ledgerStatement> | null = null;
  let reportError = '';
  let reportPending = 0;
  if (book && view === 'reports') {
    try {
      const current = reportBook(book, cloud, reportMode); reportPending = current.pending;
      report = trialBalance(current.config, current.entries, reportRange.end);
      if (ledgerId && current.config.ledgers.some((l) => l.id === ledgerId)) statement = ledgerStatement(current.config, current.entries, ledgerId, reportRange);
      if (current.blocked.length) reportError = 'Some device reversals require conflict review and are excluded from this report: ' + current.blocked.join(', ');
    } catch (e) {reportError = message(e);}
  }
  return <div className="workspace">
    <header><div><span className="eyebrow">Accounting workspace</span><h1>{book?.config.company.name ?? 'Your companies'}</h1></div>
      <div><span className="status">{cloud?.enrolled ? `Synchronized company · cursor ${cloud.cursor ?? 0}` : 'Device only · local company'}</span><button className="secondary" onClick={lock}>Lock device</button></div></header>
    <div className="layout"><aside><label className="field">Company<select aria-label="Company" value={company} onChange={(e) => { setCompany(e.target.value); setBook(null); setLedgerId(''); }}>
      <option value="">Choose company</option>{companies.map((c) => <option key={c.companyId} value={c.companyId}>{c.name}</option>)}</select></label>
      {book && <label className="field">Financial year<select aria-label="Financial year" value={yearId} onChange={(e) => { setYearId(e.target.value); const chosen = book.config.years.find((y) => y.id === e.target.value); if (chosen) setReportRange({ start: chosen.start, end: chosen.end }); }}>{book.config.years.map((y) => <option key={y.id} value={y.id}>{y.start} to {y.end}</option>)}</select></label>}
      <nav aria-label="Workspace">{['overview', 'chart', 'entry', 'reports', 'periods', 'sync', 'recovery'].map((v) => <button key={v} aria-current={view === v ? 'page' : undefined} onClick={() => changeView(v)}>{({ overview: 'Companies', chart: 'Chart of accounts', entry: 'Journal entry', reports: 'Reports', periods: 'Financial periods', sync: 'Synchronization', recovery: 'Backup & recovery' })[v]}</button>)}</nav>
      <p className="muted">Device saves persist locally. Cloud acceptance is shown separately. Keep encrypted backups on another device.</p></aside>
      <main aria-busy={busy}><div role="status" aria-live="polite">{busy ? 'Saving…' : success}</div>{error && <p role="alert" className="error">{error}</p>}
      {view === 'overview' && <Panel title="Create a company"><p>Choose your currency scale and dates explicitly. Opening balances are entered as balanced opening journals.</p>
        <form onSubmit={(e) => { void createCompany(e); }}><Field name="name" label="Company name" maxLength={200} />
          <div className="grid"><Field name="currency" label="Currency code (three uppercase letters)" maxLength={3} /><Field name="scale" label="Currency decimal places (0–6)" type="number" min={0} max={6} /></div>
          {rangeFields(today().slice(0, 4) + '-01-01', today().slice(0, 4) + '-12-31')}<Field name="booksFrom" label="Books beginning" type="date" value={today().slice(0, 4) + '-01-01'} />
          <button disabled={busy}>Create company</button></form></Panel>}
      {!book && !['overview', 'recovery', 'sync'].includes(view) && <Panel title="Select a company"><p>Choose an existing company or create one under Companies.</p></Panel>}
      {book && view === 'chart' && <>
        <Panel title="Ledgers"><table><thead><tr><th>Name</th><th>Group</th><th>Kind</th></tr></thead><tbody>{book.config.ledgers.map((l) => <tr key={l.id}><td>{l.name}</td><td>{book.config.groups.find((g) => g.id === l.groupId)?.name}</td><td>{l.kind}</td></tr>)}</tbody></table>
          <form onSubmit={(e) => { void addLedger(e); }}><Field name="name" label="Ledger name" maxLength={200} />
            <label className="field">Group<select name="groupId">{book.config.groups.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.nature}</option>)}</select></label>
            <label className="field">Ledger kind<select name="kind"><option value="general">General</option><option value="cash">Cash</option><option value="bank">Bank</option></select></label><button disabled={busy}>Add ledger</button></form></Panel>
        <Panel title="Add a subgroup"><form onSubmit={(e) => { void addGroup(e); }}><Field name="name" label="Group name" maxLength={200} /><label className="field">Parent group<select name="parentId">{book.config.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label><button disabled={busy}>Add group</button></form></Panel>
      </>}
      {book && view === 'entry' && <>
        {resolution && <p role="status" className="notice">New journal will replace rejected command {resolution}. Its device compensation remains immutable. <button className="secondary" onClick={() => setResolution('')}>Cancel replacement</button></p>}
        {cloud?.authorityError && <p role="alert" className="error">{cloud.authorityError.message}</p>}
        <Panel title="Record a journal"><p>Use positive exact amounts. Debits and credits must balance before posting.</p>
          <form key={yearId} onSubmit={(e) => { void journal(e, (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'draft'); }}>
            <div className="grid"><Field name="date" label="Journal date" type="date" value={year?.start ?? today()} />{periodSelect}</div>
            <label className="field">Entry purpose<select name="intent">{['general', 'opening', 'payment', 'receipt', 'transfer'].map((v) => <option key={v}>{v}</option>)}</select></label>
            {Array.from({ length: lineCount }, (_, i) => <fieldset key={i}><legend>Line {i + 1}</legend><div className="grid lines">
              <label className="field">Ledger<select aria-label={'Ledger ' + (i + 1)} name={'ledger' + i} required>{book.config.ledgers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              <label className="field">Side<select aria-label={'Side ' + (i + 1)} name={'side' + i} defaultValue={i % 2 === 0 ? 'debit' : 'credit'}><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
              <Field name={'amount' + i} label={'Amount ' + (i + 1)} maxLength={28} /></div></fieldset>)}
            <button type="button" className="secondary" disabled={lineCount >= 1000} onClick={() => setLineCount((n) => n + 1)}>Add line</button>
            {lineCount > 2 && <button type="button" className="secondary" onClick={() => setLineCount((n) => n - 1)}>Remove last line</button>}
            <Field name="narration" label="Narration" maxLength={2000} required={false} /><div className="actions"><button disabled={busy || book.config.ledgers.length < 2}>Post journal</button><button disabled={busy} value="draft" className="secondary">Save draft</button></div>
          </form></Panel>
        <Panel title="Saved drafts"><ul>{book.drafts.map((d) => <li key={d.id}>{d.date} · {d.narration || d.id} · {d.status} {d.status === 'draft' && <button disabled={busy} onClick={() => { void run(async () => {
          const p = book.config.periods.find((p) => p.id === d.periodId)!;
          await service.postDraft(actor, { kind: 'post-draft', commandId: uid(), draftId: d.id, entryId: uid(), expectedChartVersion: book.chartVersion, expectedDraftVersion: d.version, expectedPeriodVersion: p.version }); await refresh();
        }); }}>Post draft</button>}</li>)}</ul></Panel>
        <Panel title="Reverse a posted journal"><p>A full reversal creates a linked opposite entry. The original remains unchanged.</p><form onSubmit={(e) => { void reverse(e); }}>
          <label className="field">Original journal<select name="originalId" required>{book.entries.filter((e) => !e.reverses && !book.entries.some((r) => r.reverses === e.id)).map((e) => <option key={e.id} value={e.id}>{e.date} · {e.narration || e.id}</option>)}</select></label>
          <Field name="date" label="Reversal date" type="date" value={year?.start ?? today()} />{periodSelect}<Field name="narration" label="Reason for reversal" maxLength={2000} /><button disabled={busy}>Post reversal</button></form></Panel>
      </>}
      {book && view === 'reports' && <Panel title="Trial balance & ledger">
        {cloud?.enrolled && <><label className="field">Report basis<select value={reportMode} onChange={(e) => {setReportMode(e.target.value); setLedgerId('');}}><option value="operational">Cloud accepted plus this device's pending work</option><option value="canonical">Cloud accepted only</option><option value="device">Immutable device history</option></select></label><p>Cloud mirror as of cursor {cloud.cursor}. Pending or awaiting download: {reportPending}. Rejected work is excluded from the operational report. Device history can omit work posted on other devices.</p></>}
        <form key={yearId} onSubmit={(e) => {const data = values(e); void run(async () => { setReportRange(validRange(data)); }, 'Report period applied.'); }}>
        {rangeFields(year?.start ?? today(), year?.end ?? today())}<button disabled={busy}>Apply report period</button></form>
        <p>Trial balance is cumulative through {reportRange.end}. Ledger movement uses both dates. Currency: {book.config.company.currency.code}.</p>{reportError && <p role="alert" className="error">{reportError}</p>}
        {report && <table aria-label="Trial balance"><thead><tr><th>Ledger</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{report.rows.map((r) => <tr key={r.ledgerId}><td><button className="link" onClick={() => setLedgerId(r.ledgerId)}>{r.ledgerName}</button></td><td>{amount(r.debit, scale)}</td><td>{amount(r.credit, scale)}</td></tr>)}</tbody><tfoot><tr><th>Total</th><td>{amount(report.debit, scale)}</td><td>{amount(report.credit, scale)}</td></tr></tfoot></table>}
        {statement && <><h3>{statement.ledgerName}</h3><p>Opening: {amount(statement.opening, scale)} · Closing: {amount(statement.closing, scale)} (debit positive)</p><table aria-label="Ledger statement"><thead><tr><th>Date / journal</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>{statement.rows.map((r, i) => <tr key={i}><td>{r.date}<small>{r.entryId}</small></td><td>{amount(r.debit, scale)}</td><td>{amount(r.credit, scale)}</td><td>{amount(r.balance, scale)}</td></tr>)}</tbody></table></>}
      </Panel>}
      {book && view === 'periods' && <Panel title="Financial periods"><p>Posting checks the current version and lock inside each durable transaction. Reopening requires an audit reason.</p>
        {periodOptions.map((p: FinancialPeriod) => <form key={p.id} onSubmit={(e) => { const data = values(e); void run(async () => {
          await master({ kind: 'period-status', commandId: uid(), periodId: p.id, expectedVersion: p.version, status: p.status === 'open' ? 'locked' : 'open', reason: get(data, 'reason') }); await refresh();
        }); }}><h3>{p.start} to {p.end} · {p.status}</h3><Field name={'reason'} label="Audit reason" maxLength={2000} /><button disabled={busy}>{p.status === 'open' ? 'Lock period' : 'Reopen period'}</button></form>)}
        <h3>Add a financial year</h3><p>Creates a separate year and its initial posting period. Existing history is retained; overlapping years are rejected.</p>
        <form onSubmit={(e) => { void addYear(e); }}>
          {rangeFields(String(Number(year?.end.slice(0, 4) ?? today().slice(0, 4)) + 1) + '-01-01', String(Number(year?.end.slice(0, 4) ?? today().slice(0, 4)) + 1) + '-12-31')}
          <Field name="reason" label="Reason for adding year" maxLength={2000} /><button disabled={busy}>Add financial year</button>
        </form>
      </Panel>}
      {view === 'sync' && <CloudPanel key={company} host={host} native={native} cloud={cloud} book={book} busy={busy} run={run} refresh={refresh} selected={company} choose={(id) => {setCompany(id); setBook(null);}} />}
      {book && cloud?.enrolled && view === 'sync' && <Panel title="Resolve a rejected device journal"><p>First post a device-only full compensation in an open period, then enter a new replacement. If a full local reversal already exists, this action designates it as compensation only when both commands have durable cloud exceptions. The rejected journal and its reason remain in history. Unknown service responses must be retried before resolution.</p>
        <form onSubmit={(e) => {const data = values(e); void run(async () => {
          const command = get(data, 'originalCommand'); const receipt = book.receipts.find((r) => r.commandId === command);
          if (!receipt || !('createdAt' in receipt.result)) throw new Error('Select a rejected journal.');
          const originalId = receipt.result.id;
          const existing = book.entries.find((e) => e.reverses === originalId);
          if (existing) {
            const reversed = book.receipts.find((r) => 'createdAt' in r.result && r.result.id === existing.id);
            if (!reversed) throw new Error('Reversal receipt is missing; preserve a backup and review recovery.');
            await native('cloud_designate_compensation', { companyId: company, originalCommand: command, reversalCommand: reversed.commandId, reason: get(data, 'reason') });
            await refresh(); setResolution(command); return;
          }
          const period = book.config.periods.find((p) => p.id === get(data, 'periodId')); if (!period) throw new Error('Select an open period.');
          const compensating = new AccountingService(new ClientBookStore(native, { resolutionMode: 'compensate', originalCommand: command }), () => new Date().toISOString());
          const input = { tenantId: actor.tenantId, companyId: actor.companyId, id: uid(), date: get(data, 'date'), periodId: period.id, expectedPeriodVersion: period.version, narration: get(data, 'reason') };
          if (receipt.result.reverses) await compensating.post(actor, { kind: 'post', commandId: uid(), expectedChartVersion: book.chartVersion,
            journal: { ...input, intent: 'general', lines: receipt.result.lines.map((l) => ({ ledgerId: l.ledgerId, amount: l.amount, side: l.side === 'debit' ? 'credit' : 'debit' })) } });
          else await compensating.reverse(actor, { kind: 'reverse', commandId: uid(), originalId: receipt.result.id, expectedChartVersion: book.chartVersion, journal: input });
          await refresh(); setResolution(command);
        }, 'Device compensation saved. Enter the replacement journal when ready.'); }}>
          <label className="field">Rejected command<select name="originalCommand" required>{cloud.commands?.filter((c) => ['rejected', 'conflict'].includes(c.state) && book.receipts.some((r) => r.commandId === c.commandId && 'createdAt' in r.result)).map((c) => <option key={c.commandId} value={c.commandId}>{c.commandId} · {c.code}</option>)}</select></label>
          <Field name="date" label="Compensation date" type="date" value={year?.start ?? today()} />{periodSelect}<Field name="reason" label="Resolution reason" maxLength={2000} /><button disabled={busy}>Save or designate device compensation</button>
        </form>
        <label className="field">Resume replacement<select value={resolution} onChange={(e) => setResolution(e.target.value)}><option value="">Choose a compensated command</option>{cloud.resolutions?.filter((r) => !cloud.commands?.some((c) => c.replaces === r.root && c.state === 'accepted')).map((r) => <option key={r.originalCommand} value={r.originalCommand}>{r.originalCommand}</option>)}</select></label><button className="secondary" disabled={!resolution || busy} onClick={() => changeView('entry')}>Enter replacement journal</button>
      </Panel>}
      {view === 'recovery' && <Panel title="Encrypted backup & recovery"><p>Back up all companies to another device. Backups include this vault's credential verifier. Restoring replaces current records and locks the app; unlock with the device password that existed when the backup was taken. Synchronized companies require online recovery reconciliation before further posting.</p>
        <p>Make a fresh backup before restoring. Password loss cannot be repaired by support. A wrong passphrase or damaged backup leaves current data unchanged.</p>
        <form onSubmit={(e) => { void backup(e); }}><Field name="passphrase" label="Backup encryption passphrase" type="password" minLength={12} maxLength={1024} autoComplete="off" />
          <label className="field">Operation<select name="action" aria-label="Operation"><option value="backup">Save encrypted backup</option><option value="restore">Restore encrypted backup</option></select></label>
          <label className="check"><input type="checkbox" name="confirmed" />I have made a current backup and approve replacing this device's data when restoring.</label><button disabled={busy}>Choose backup file</button></form>
      </Panel>}
    </main></div></div>;
}

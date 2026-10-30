import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccountingError, identifier } from '@erp/domain';
import { encode, MAX_BODY, parse, roleSchema, z } from '@erp/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { Auth } from './auth.js';
import { Cloud } from './cloud.js';
import { Administration } from './admin.js';

interface Options { db: PrismaClient; signingKey: string; bootstrapToken: string; grantSeconds?: number }
const text = z.string().min(1).max(200);
const reason = z.string().min(1).max(2000);
const ids = z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/)).max(100);
const loginSchema = z.strictObject({ username: z.string().min(3).max(80), password: z.string().min(1).max(1024) });
const bootstrapSchema = loginSchema.extend({ token: z.string().min(32).max(256), tenantName: text });
const deviceSchema = z.strictObject({ deviceId: z.string().min(1).max(100), generation: z.string().min(1).max(100) });
const memberSchema = loginSchema.extend({ role: roleSchema, companies: ids, reason });
const updateMember = z.strictObject({ role: roleSchema, disabled: z.boolean(), expectedVersion: z.number().int().positive(), companies: ids, reason });
function reply(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer' });
  response.end(encode(value));
}
async function body(request: IncomingMessage, limit = MAX_BODY): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AccountingError('INVALID_CONTENT_TYPE', 'Use application/json.');
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const data of request) {
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as string);
    bytes += chunk.length;
    if (bytes > limit) throw new AccountingError('DATA_LIMIT', 'Request exceeds the supported size.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new AccountingError('INVALID_JSON', 'Request must contain valid JSON.'); }
}
export function handler(options: Options): (request: IncomingMessage, response: ServerResponse) => void {
  const auth = new Auth(options.db, options.bootstrapToken);
  const cloud = new Cloud(options.db, options.signingKey, options.grantSeconds);
  const admin = new Administration(options.db);
  const limits = new Map<string, { start: number; count: number }>();
  let active = 0;
  return (request, response) => {
    const run = async () => {
      if (active >= 16) throw new AccountingError('RATE_LIMIT', 'Server is busy. Retry shortly.');
      active++;
      try {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        const method = request.method ?? 'GET';
        if (parts.length === 1 && parts[0] === 'health' && method === 'GET') return reply(response, 200, { protocol: 1, status: 'ok' });
        if (parts[0] !== 'v1') throw new AccountingError('NOT_FOUND', 'Endpoint not found.');
        if (parts[1] === 'auth') {
          const now = Date.now(); const address = request.socket.remoteAddress ?? 'unknown';
          if (limits.size > 10000) for (const [key, row] of limits) if (now - row.start > 300000) limits.delete(key);
          const rate = limits.get(address);
          if (rate && now - rate.start < 300000) {
            if (rate.count >= 30) throw new AccountingError('RATE_LIMIT', 'Wait before retrying authentication.');
            rate.count++;
          } else limits.set(address, { start: now, count: 1 });
          if (parts[2] === 'bootstrap' && method === 'POST') {
            const input = parse(bootstrapSchema, await body(request, 8192));
            return reply(response, 201, await auth.initialize(input.token, input.username, input.password, input.tenantName));
          }
          if (parts[2] === 'login' && method === 'POST') {
            const input = parse(loginSchema, await body(request, 8192));
            const login = await auth.signIn(input.username, input.password);
            return reply(response, 200, { ...login, tenants: await auth.tenants({ userId: login.userId, username: login.username }) });
          }
        }
        const authorization = request.headers.authorization ?? '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const actor = await auth.authenticate(token);
        if (parts[1] === 'auth' && parts[2] === 'logout' && method === 'POST') {
          await auth.signOut(token); return reply(response, 200, { signedOut: true });
        }
        if (parts[1] !== 'tenants') throw new AccountingError('NOT_FOUND', 'Endpoint not found.');
        if (parts.length === 2) {
          if (method === 'GET') return reply(response, 200, await auth.tenants(actor));
          if (method === 'POST') {
            const input = parse(z.strictObject({ name: text }), await body(request, 8192));
            return reply(response, 201, { id: await admin.tenant(actor, input.name) });
          }
        }
        const tenant = identifier(parts[2] ?? '', 'tenantId');
        if (parts[3] === 'enrollments' && parts[5] === 'cancel' && method === 'POST') {
          const input = parse(z.strictObject({ confirmed: z.literal(true), reason }), await body(request, 8192));
          return reply(response, 200, await cloud.cancelEnrollment(actor, tenant, identifier(parts[4] ?? '', 'enrollmentId'), input.reason));
        }
        if (parts[3] === 'members') {
          if (parts.length === 4 && method === 'GET') return reply(response, 200, await admin.members(actor, tenant));
          if (parts.length === 4 && method === 'POST') return reply(response, 201, { id: await admin.addUser(actor, tenant, parse(memberSchema, await body(request, 16384))) });
          if (parts.length === 5 && method === 'PUT') {
            await admin.updateUser(actor, tenant, identifier(parts[4]!, 'userId'), parse(updateMember, await body(request, 16384)));
            return reply(response, 200, { updated: true });
          }
        }
        if (parts[3] !== 'companies') throw new AccountingError('NOT_FOUND', 'Endpoint not found.');
        if (parts.length === 4) {
          if (method === 'GET') return reply(response, 200, await cloud.companies(actor, tenant));
          if (method === 'POST') {
            const input = await body(request);
            if ((input as { protocol?: unknown })?.protocol !== 1) throw new AccountingError('UNSUPPORTED_PROTOCOL', 'This service supports protocol 1. Keep local work and upgrade the client.');
            return reply(response, 201, await cloud.enroll(actor, tenant, input));
          }
        }
        const scope = { tenantId: tenant, companyId: identifier(parts[4] ?? '', 'companyId') };
        if (parts[5] === 'join' && method === 'POST') {
          const input = parse(deviceSchema.extend({ sourceTenant: z.string().min(1).max(100), sourceCompany: z.string().min(1).max(100), confirmed: z.literal(true) }), await body(request, 8192));
          return reply(response, 200, await cloud.join(actor, scope, { ...input, deviceId: identifier(input.deviceId, 'deviceId'), generation: identifier(input.generation, 'generation'),
            sourceTenant: identifier(input.sourceTenant, 'sourceTenant'), sourceCompany: identifier(input.sourceCompany, 'sourceCompany') }));
        }
        if (parts[5] === 'commands' && method === 'POST') {
          const input = await body(request);
          if ((input as { protocol?: unknown })?.protocol !== 1) throw new AccountingError('UNSUPPORTED_PROTOCOL', 'This service supports protocol 1. Keep local work and upgrade the client.');
          return reply(response, 200, await cloud.submit(actor, scope, input));
        }
        if (parts[5] === 'grant' && method === 'POST') {
          const input = parse(deviceSchema, await body(request, 8192));
          return reply(response, 200, await cloud.renew(actor, scope, identifier(input.deviceId, 'deviceId'), identifier(input.generation, 'generation')));
        }
        if (parts[5] === 'recover' && method === 'POST') {
          const input = parse(deviceSchema.extend({ confirmed: z.literal(true) }), await body(request, 8192));
          return reply(response, 200, await cloud.recover(actor, scope, identifier(input.deviceId, 'deviceId'), identifier(input.generation, 'generation')));
        }
        if (parts[5] === 'receipts' && method === 'POST') {
          const input = parse(z.strictObject({ ids }), await body(request, 16384));
          return reply(response, 200, await cloud.receipts(actor, scope, input.ids));
        }
        if (parts[5] === 'changes' && method === 'GET') return reply(response, 200,
          await cloud.pull(actor, scope, Number(url.searchParams.get('after') ?? '-1'), identifier(url.searchParams.get('epoch') ?? '', 'epoch'), Number(url.searchParams.get('limit') ?? '20')));
        if (parts[5] === 'snapshot' && method === 'GET') return reply(response, 200, await cloud.snapshot(actor, scope));
        if (parts[5] === 'revoke-device' && method === 'POST') {
          const input = parse(z.strictObject({ deviceId: z.string().min(1).max(100), reason }), await body(request, 8192));
          await admin.revokeDevice(actor, tenant, scope.companyId, identifier(input.deviceId, 'deviceId'), input.reason);
          return reply(response, 200, { revoked: true });
        }
        throw new AccountingError('NOT_FOUND', 'Endpoint not found.');
      } finally { active--; }
    };
    void run().catch((error: unknown) => {
      const known = error instanceof AccountingError;
      const code = known ? error.code : 'SERVER_ERROR';
      const status = code === 'AUTHENTICATION_FAILED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' || code === 'BOOK_NOT_FOUND' ? 404 :
        code === 'RATE_LIMIT' ? 429 : code === 'DATA_LIMIT' ? 413 : ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'GENERATION_CONFLICT', 'CURSOR_AHEAD', 'CURSOR_GAP', 'COMPANY_ALREADY_EXISTS', 'ALREADY_ENROLLED', 'ENROLLMENT_CANCELLED'].includes(code) ? 409 : known ? 400 : 500;
      if (status === 429) response.setHeader('retry-after', '2');
      reply(response, status, { error: { code, message: known ? error.message : 'Server operation failed. Retry with the same command ID.',
        field: known ? error.field : null } });
    });
  };
}
export function createApi(options: Options) {
  const server = createServer(handler(options));
  server.requestTimeout = 20000; server.headersTimeout = 10000; server.maxConnections = 64;
  return server;
}

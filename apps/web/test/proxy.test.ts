import { test, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GET, POST } from '../src/app/api/accounting/[...path]/route.js';
let upstream: ReturnType<typeof createServer>;
let observed: {
    authorization: string | undefined;
    cookie: string | undefined;
    url: string | undefined;
}[] = [];
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
beforeAll(async () => { upstream = createServer((req, res) => { observed.push({ authorization: req.headers.authorization, cookie: req.headers.cookie, url: req.url }); if (req.url === '/v1/redirect') {
    res.writeHead(302, { location: 'https://untrusted.invalid/' });
    res.end();
}
else {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public', 'set-cookie': 'must-not-forward=yes' });
    res.end(JSON.stringify({ synthetic: 'private-company-value' }));
} }); await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r)); process.env['ERP_API_ORIGIN'] = 'http://127.0.0.1:' + (upstream.address() as AddressInfo).port; });
afterAll(async () => { upstream.closeAllConnections(); await new Promise<void>(r => upstream.close(() => r())); delete process.env['ERP_API_ORIGIN']; });
test('fixed-origin proxy forwards only explicit bearer, marks responses private/no-store and drops cookies', async () => {
    observed = [];
    const reply = await GET(new Request('http://workspace.test/api/accounting/v1/tenants?after=1', { headers: { authorization: 'Bearer ' + 'a'.repeat(64), cookie: 'owner-cookie=synthetic' } }), context(['v1', 'tenants']));
    expect(reply.status).toBe(200);
    expect(reply.headers.get('cache-control')).toBe('no-store');
    expect(reply.headers.get('set-cookie')).toBeNull();
    expect(observed).toEqual([{ authorization: 'Bearer ' + 'a'.repeat(64), cookie: undefined, url: '/v1/tenants?after=1' }]);
});
test('proxy rejects foreign origins, bootstrap, injected path segments, malformed bearers and oversized auth before upstream', async () => {
    observed = [];
    expect((await POST(new Request('http://workspace.test/api/accounting/v1/auth/login', { method: 'POST', headers: { origin: 'https://other.invalid', 'content-type': 'application/json' }, body: '{}' }), context(['v1', 'auth', 'login']))).status).toBe(403);
    expect((await POST(new Request('http://workspace.test/api/accounting/v1/auth/bootstrap', { method: 'POST' }), context(['v1', 'auth', 'bootstrap']))).status).toBe(403);
    expect((await GET(new Request('http://workspace.test/api/accounting/v1/path'), context(['v1', 'https://other.invalid']))).status).toBe(404);
    expect((await GET(new Request('http://workspace.test/api/accounting/v1/tenants', { headers: { authorization: 'Bearer bad' } }), context(['v1', 'tenants']))).status).toBe(401);
    expect((await POST(new Request('http://workspace.test/api/accounting/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(8193) }), context(['v1', 'auth', 'login']))).status).toBe(413);
    expect(observed).toHaveLength(0);
});
test('service redirects cannot send a credential to another origin', async () => { const response = await GET(new Request('http://workspace.test/api/accounting/v1/redirect', { headers: { authorization: 'Bearer ' + 'b'.repeat(64) } }), context(['v1', 'redirect'])); expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ error: { code: 'UNTRUSTED_REDIRECT' } }); });

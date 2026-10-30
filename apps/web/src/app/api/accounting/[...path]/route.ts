export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX = 16 * 1024 * 1024;
const RESPONSE_MAX = 18 * 1024 * 1024;
function failure(code: string, message: string, status = 502) {
  return Response.json({ error: { code, message, field: null } }, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
async function bounded(stream: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {const result = await reader.read(); if (result.done) break; length += result.value.length; if (length > max) {await reader.cancel(); throw new Error('DATA_LIMIT');} chunks.push(result.value);}
  } finally {reader.releaseLock();}
  const joined = new Uint8Array(length); let offset = 0; for (const chunk of chunks) {joined.set(chunk, offset); offset += chunk.length;} return joined;
}
async function forward(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const incoming = new URL(request.url);
  if (request.headers.get('origin') && request.headers.get('origin') !== incoming.origin) return failure('FORBIDDEN', 'Use the workspace origin.', 403);
  const parts = (await context.params).path;
  if (!parts.length || parts.some((p) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(p)) || (parts[0] !== 'v1' && !(parts.length === 1 && parts[0] === 'health')))
    return failure('NOT_FOUND', 'Unsupported accounting route.', 404);
  if (parts[0] === 'v1' && parts[1] === 'auth' && parts[2] === 'bootstrap') return failure('FORBIDDEN', 'An operator must initialize the service separately.', 403);
  const raw = process.env['ERP_API_ORIGIN'] ?? 'http://127.0.0.1:4318';
  try {
    const target = new URL(raw);
    if (target.username || target.password || target.search || target.hash || target.pathname !== '/' ||
      (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1', '[::1]', '::1'].includes(target.hostname))))
      return failure('SERVICE_CONFIGURATION', 'The accounting service origin is not configured securely.', 503);
    target.pathname = '/' + parts.map(encodeURIComponent).join('/'); target.search = incoming.search;
    const headers: Record<string, string> = {};
    const bearer = request.headers.get('authorization');
    if (bearer) {if (!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(bearer)) return failure('AUTHENTICATION_FAILED', 'Invalid service session.', 401); headers['authorization'] = bearer;}
    const mutating = request.method !== 'GET';
    if (mutating) {if (!request.headers.get('content-type')?.startsWith('application/json')) return failure('INVALID_CONTENT_TYPE', 'Use JSON for accounting requests.', 400); headers['content-type'] = 'application/json';}
    const data = mutating ? await bounded(request.body, parts[1] === 'auth' ? 8192 : MAX) : undefined;
    const response = await fetch(target, { method: request.method, headers, ...(data ? { body: data } : {}), cache: 'no-store', redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
    if (response.status >= 300 && response.status < 400) return failure('UNTRUSTED_REDIRECT', 'Service redirects are blocked. Original local work is retained.');
    if (!response.headers.get('content-type')?.startsWith('application/json')) return failure('INVALID_SERVICE_RESPONSE', 'Service returned an unsupported response.');
    const bytes = await bounded(response.body, RESPONSE_MAX);
    const outgoing: Record<string, string> = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    const retry = response.headers.get('retry-after'); if (retry && /^\d{1,3}$/.test(retry)) outgoing['retry-after'] = retry;
    return new Response(bytes, { status: response.status, headers: outgoing });
  } catch (error) {
    return error instanceof Error && error.message === 'DATA_LIMIT' ? failure('DATA_LIMIT', 'Service request/response exceeds the supported size.', 413) : failure('NETWORK_UNAVAILABLE', 'Service response is unknown. Local records are retained; retry the original command.', 503);
  }
}
export const GET = forward;
export const POST = forward;
export const PUT = forward;

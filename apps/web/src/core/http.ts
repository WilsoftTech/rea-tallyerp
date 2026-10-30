import { AccountingError } from '@erp/domain';
import { encode } from '@erp/contracts/codec';
export class ServiceError extends AccountingError {
    constructor(code: string, message: string, field: string | null = null, readonly retryAfter: number | null = null) { super(code, message, field); }
}
export async function service(origin: string, path: string, method = 'GET', data?: unknown, token?: string): Promise<unknown> {
    if (!path.startsWith('/v1/') && path !== '/health')
        throw new AccountingError('UNSUPPORTED_OPERATION', 'Unsupported service route.');
    const body = data === undefined ? undefined : encode(data);
    if (body && new TextEncoder().encode(body).length > 16 * 1024 * 1024)
        throw new AccountingError('DATA_LIMIT', 'Service request exceeds the supported size.');
    let response: Response;
    try {
        response = await fetch(new URL('/api/accounting' + path, origin), { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body } : {}), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
    }
    catch {
        throw new ServiceError('NETWORK_UNAVAILABLE', 'Service response is unknown. Local records are retained; retry the original command.');
    }
    let text: string;
    try {
        const reader = response.body?.getReader();
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        if (reader) {
            try {
                for (;;) {
                    const next = await reader.read();
                    if (next.done)
                        break;
                    bytes += next.value.length;
                    if (bytes > 18 * 1024 * 1024) {
                        await reader.cancel();
                        throw new AccountingError('DATA_LIMIT', 'Service response exceeds this version’s size limit.');
                    }
                    chunks.push(next.value);
                }
            }
            finally {
                reader.releaseLock();
            }
        }
        const buffer = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.length;
        }
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    }
    catch (cause) {
        if (cause instanceof AccountingError)
            throw cause;
        throw new ServiceError('NETWORK_UNAVAILABLE', 'Service response was interrupted. No financial outcome was inferred.');
    }
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    }
    catch {
        throw new ServiceError('INVALID_SERVICE_RESPONSE', 'Service returned an unsupported response. No financial outcome was inferred.');
    }
    if (!response.ok) {
        const row = (value as {
            error?: {
                code?: unknown;
                message?: unknown;
                field?: unknown;
            };
        })?.error;
        const code = typeof row?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(row.code) ? row.code : 'SERVER_ERROR';
        const message = typeof row?.message === 'string' && row.message.length <= 2000 ? row.message : 'Service operation failed; original local work is retained.';
        const field = typeof row?.field === 'string' && /^[A-Za-z0-9_.]{1,100}$/.test(row.field) ? row.field : null;
        const retry = response.headers.get('retry-after');
        const seconds = retry && /^\d{1,3}$/.test(retry) ? Math.min(300, Math.max(1, Number(retry))) : null;
        throw new ServiceError(code, message, field, seconds);
    }
    return value;
}

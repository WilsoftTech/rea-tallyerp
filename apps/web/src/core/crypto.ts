import { AccountingError, ensure } from '@erp/domain';
import { grantSchema, parse } from '@erp/contracts';
import type { Grant, SignedGrant } from '@erp/contracts';
import type { Credential, Profile } from './records.js';
const ITERATIONS = 600000;
export const BACKUP_LIMIT = 128 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const magic = encoder.encode('ERPWEB01');
export function randomId(): string { return crypto.randomUUID(); }
export function now(): number { return Math.floor(Date.now() / 1000); }
function password(value: string): void { ensure(typeof value === 'string' && value.length >= 12 && value.length <= 1024, 'INVALID_PASSWORD', 'Use a password or passphrase of 12–1024 characters.'); }
export function base64(bytes: Uint8Array): string { let raw = ''; for (const b of bytes)
    raw += String.fromCharCode(b); return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function unbase64(text: string): Uint8Array<ArrayBuffer> { ensure(typeof text === 'string' && text.length <= 12000 && /^[A-Za-z0-9_-]+$/.test(text), 'INVALID_CRYPTO_DATA', 'Unsupported signature or credential encoding.'); try {
    return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
catch {
    throw new AccountingError('INVALID_CRYPTO_DATA', 'Unsupported signature or credential encoding.');
} }
async function key(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    password(passphrase);
    ensure(globalThis.crypto?.subtle, 'UNSUPPORTED_BROWSER', 'This browser requires a secure context with Web Crypto.');
    const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function credential(password: string): Promise<Credential> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('ERP browser vault v1') }, await key(password, salt), encoder.encode('Owner credential verified'));
    return { salt: base64(salt), iv: base64(iv), cipher: base64(new Uint8Array(cipher)) };
}
export async function unlock(password: string, value: Credential): Promise<void> {
    try {
        const salt = unbase64(value.salt), iv = unbase64(value.iv), cipher = unbase64(value.cipher);
        ensure(salt.length === 16 && iv.length === 12, 'INVALID_VAULT', 'Stored credential is unsupported. Preserve this workspace.');
        const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('ERP browser vault v1') }, await key(password, salt), cipher);
        ensure(decoder.decode(clear) === 'Owner credential verified', 'INVALID_PASSWORD', 'Workspace password is incorrect.');
    }
    catch (cause) {
        if (cause instanceof AccountingError && cause.code === 'INVALID_PASSWORD')
            throw cause;
        throw new AccountingError('AUTHENTICATION_FAILED', 'Workspace password is incorrect or its credential record is damaged. Records were preserved.');
    }
}
export async function encryptBackup(passphrase: string, plain: string): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = encoder.encode(plain);
    ensure(bytes.length + 56 <= BACKUP_LIMIT, 'BACKUP_TOO_LARGE', 'Backup exceeds the browser version’s 128 MiB limit.');
    const header = new Uint8Array(40);
    header.set(magic);
    new DataView(header.buffer).setUint32(8, ITERATIONS);
    header.set(crypto.getRandomValues(new Uint8Array(16)), 12);
    header.set(crypto.getRandomValues(new Uint8Array(12)), 28);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: header.slice(28, 40), additionalData: header }, await key(passphrase, header.slice(12, 28)), bytes);
    const output = new Uint8Array(header.length + cipher.byteLength);
    output.set(header);
    output.set(new Uint8Array(cipher), 40);
    return output;
}
export async function decryptBackup(passphrase: string, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    ensure(bytes.length >= 56 && bytes.length <= BACKUP_LIMIT && magic.every((b, i) => bytes[i] === b) && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8) === ITERATIONS, 'INVALID_BACKUP', 'Choose a supported ERPWEB01 encrypted browser backup. Windows ERPBAK01 backups require the Windows application.');
    try {
        const header = bytes.slice(0, 40);
        return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: header.slice(28, 40), additionalData: header }, await key(passphrase, header.slice(12, 28)), bytes.slice(40)));
    }
    catch {
        throw new AccountingError('BACKUP_AUTH_FAILED', 'Wrong passphrase or damaged backup. Current browser records were preserved.');
    }
}
export async function verifyGrant(signed: SignedGrant, p: Pick<Profile, 'publicKey' | 'remoteTenant' | 'remoteCompany' | 'tenant' | 'company' | 'userId' | 'deviceId' | 'generation' | 'epoch' | 'lastSeen'>, clock = now(), inspectEpoch = false): Promise<Grant> {
    ensure(signed && signed.publicKey === p.publicKey && signed.payload.length <= 8192, 'UNTRUSTED_GRANT', 'Offline authority does not match the pinned service key.');
    const raw = unbase64(signed.publicKey), signature = unbase64(signed.signature), payload = unbase64(signed.payload);
    ensure(raw.length === 32 && signature.length === 64, 'UNTRUSTED_GRANT', 'Unsupported offline signature/key size.');
    try {
        const publicKey = await crypto.subtle.importKey('raw', raw, 'Ed25519', false, ['verify']);
        ensure(await crypto.subtle.verify('Ed25519', publicKey, signature, payload), 'UNTRUSTED_GRANT', 'Offline signature did not verify.');
    }
    catch (cause) {
        if (cause instanceof AccountingError)
            throw cause;
        throw new AccountingError('UNSUPPORTED_SIGNATURE', 'This browser could not verify Ed25519 offline authority. Read/backup remain available; use a supported browser.');
    }
    const grant = parse(grantSchema, JSON.parse(decoder.decode(payload)) as unknown);
    ensure(grant.tenantId === p.remoteTenant && grant.companyId === p.remoteCompany && grant.sourceTenant === p.tenant && grant.sourceCompany === p.company && grant.userId === p.userId && grant.deviceId === p.deviceId && grant.generation === p.generation && (inspectEpoch || grant.epoch === p.epoch), 'UNTRUSTED_GRANT', 'Offline authority belongs to another account, company, device or recovery generation.');
    ensure(Number.isSafeInteger(grant.issuedAt) && Number.isSafeInteger(grant.expiresAt) && grant.expiresAt > grant.issuedAt && grant.expiresAt - grant.issuedAt <= 86400 && new Set(grant.permissions).size === grant.permissions.length, 'UNTRUSTED_GRANT', 'Offline permissions have an unsupported duration or duplicate rights.');
    ensure(clock + 300 >= p.lastSeen && grant.issuedAt <= clock + 300, 'CLOCK_ROLLBACK', 'Correct the device clock and reconnect before posting.');
    ensure(clock < grant.expiresAt, 'OFFLINE_GRANT_EXPIRED', 'Offline posting permission expired. Read and encrypted backup remain available; reconnect to renew.');
    return grant;
}

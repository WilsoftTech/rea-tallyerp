import type { SignedGrant } from '@erp/contracts';
export type ScopeKey = [
    string,
    string
];
export interface Credential {
    salt: string;
    iv: string;
    cipher: string;
}
export interface Vault {
    id: 'vault';
    tenantId: string;
    generation: string;
    credential: Credential;
}
export interface Book {
    key: ScopeKey;
    tenant: string;
    company: string;
    revision: number;
    state: string;
}
export type DeliveryState = 'not-enrolled' | 'pending' | 'sending' | 'accepted' | 'rejected' | 'conflict';
export interface Delivery {
    key: [
        string,
        string,
        string
    ];
    tenant: string;
    company: string;
    command: string;
    payload: string;
    wire: string | null;
    state: DeliveryState;
    sequence: number;
    attempts: number;
    nextAttempt: number;
    leaseUntil: number;
    leaseOwner: string | null;
    lastError: string | null;
    serverCursor: number | null;
    root: string | null;
    localOnly: boolean;
}
export interface Profile {
    key: ScopeKey;
    tenant: string;
    company: string;
    endpoint: string;
    remoteTenant: string;
    remoteCompany: string;
    userId: string;
    deviceId: string;
    generation: string;
    epoch: string;
    publicKey: string;
    grant: SignedGrant;
    cursor: number;
    canonical: string;
    paused: string | null;
    lastSeen: number;
    lastOnline: number;
    version: number;
    leaseOwner: string | null;
    leaseUntil: number;
}
export interface Intent {
    key: [
        string,
        string,
        string
    ];
    tenant: string;
    company: string;
    command: string;
    wire: string;
    state: 'pending' | 'accepted' | 'rejected' | 'conflict';
    result: string | null;
    lastError: string | null;
}
export interface Enrollment {
    key: ScopeKey;
    tenant: string;
    company: string;
    endpoint: string;
    remoteTenant: string;
    enrollmentId: string;
    deviceId: string;
    generation: string;
    body: string;
}
export interface Join {
    key: [
        string,
        string,
        string,
        string
    ];
    tenant: string;
    remoteTenant: string;
    remoteCompany: string;
    userId: string;
    localCompany: string;
    deviceId: string;
    generation: string;
}
export interface Resolution {
    key: [
        string,
        string,
        string
    ];
    tenant: string;
    company: string;
    root: string;
    originalCommand: string;
    compensation: string;
    replacement: string | null;
    reason: string;
}
export interface SyncEvent {
    id: string;
    tenant: string;
    company: string;
    at: string;
    action: string;
    detail: string;
}
export interface Records {
    meta: Vault;
    books: Book;
    outbox: Delivery;
    profiles: Profile;
    intents: Intent;
    enrollments: Enrollment;
    joins: Join;
    resolutions: Resolution;
    events: SyncEvent;
}
export const TABLES = ['meta', 'books', 'outbox', 'profiles', 'intents', 'enrollments', 'joins', 'resolutions', 'events'] as const;
export type Table = keyof Records;

import { App as SharedApp } from '@erp/workspace/ui';
import type { Host } from '@erp/workspace/host';
import { client } from './native.js';
const host: Host = { platform: 'desktop', createClient: client };
export function App() { return <SharedApp host={host} />; }

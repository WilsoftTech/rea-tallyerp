import type { ReactNode } from 'react';
import '@erp/workspace/styles.css';
export const metadata = { title: 'Accounting Workspace', description: 'Original offline-first accounting workspace', manifest: '/manifest.webmanifest' };
export default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }

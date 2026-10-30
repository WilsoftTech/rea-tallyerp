export default function manifest() {
  return { name: 'Accounting Workspace', short_name: 'Accounts', description: 'Offline accounting with explicit cloud acceptance',
    start_url: '/', scope: '/', display: 'standalone', background_color: '#f3f5f8', theme_color: '#173f78',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] };
}

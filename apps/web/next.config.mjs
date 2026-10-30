const production = process.env.NODE_ENV === 'production';
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'" + (production ? '' : " 'unsafe-eval'") + "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
export default {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@erp/workspace', '@erp/contracts', '@erp/application', '@erp/domain'],
  webpack(config) { config.resolve.extensionAlias={...config.resolve.extensionAlias,'.js':['.ts','.tsx','.js'],'.jsx':['.tsx','.jsx']}; return config; },
  async headers() { return [
    { source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: csp }, { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'no-referrer' }] },
    { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }, { key: 'Service-Worker-Allowed', value: '/' }] },
  ]; },
};

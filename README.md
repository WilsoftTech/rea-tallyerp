# rea-tallyerp

Original offline-first accounting ERP. Phases 1–4 are approved and closed. Phase 5 (offline browser host) is technically complete (6/6) and awaiting owner approval. Approval and evidence are recorded in [phase status](docs/progress/phase-status.md). Phase 6 remains blocked.

See [documentation](docs/README.md) and the [roadmap](ROADMAP.md). Product branding, installation packaging and production deployment remain later work.

## Development

Requires Node.js 24/npm 11, Windows C++ build tools, Rust MSVC and WebView2. Use `npm.cmd` when PowerShell blocks npm.ps1. Helpers reuse the ignored workspace Rust toolchain when present.

```sh
npm ci --ignore-scripts --cache .cache/npm
npm run db:start
npm run build
npm run native:harness
npm run desktop:debug
npm run typecheck
npm run lint
npm test
npm run native:test
npm run native:lint
npm run native:fmt
npm run check:built
npm run check:api
npm run check:foundation
```

`db:start` expects PostgreSQL Windows binaries under ignored `.cache/postgresql/{bin,lib,share}`; this host uses the official portable PostgreSQL 18.6 download recorded in the phase evidence. It starts an isolated loopback cluster on port 55438, applies checked forward SQL migrations and creates a non-owner runtime role. Credentials and the Ed25519 signing key stay in ignored `.cache/cloud`. It provisions no external hosting or Windows service. See [database operations](docs/architecture/database.md).

`npm test` requires the real PostgreSQL cluster, native harness, embedded debug executable, production web build and installed test browsers. Run `node tools/web.mjs browsers` once to download only the test Firefox into ignored `.cache/playwright`; tests use the installed Chrome and Edge. The suite includes actual IndexedDB/production service-worker/browser/WebView2/native/API integration; unavailable prerequisites fail rather than silently skip. Browser files run sequentially to bound resource use. `npm run test:desktop` separately runs the standalone desktop flow. `npm run desktop:dev` opens development mode; `npm run desktop:build` builds a Windows executable without an installer or bundled Node server. When another desktop executable is in use, build with a separate `CARGO_TARGET_DIR` and point `ERP_NATIVE_TEST_EXE` at that embedded test executable.

Run `npm run api:start` after the build to start the loopback development service using the ignored environment file. An operator must initialize its first owner through the one-time, bootstrap-token-protected `POST /v1/auth/bootstrap` endpoint with token, username, password and tenantName. No default user/password is seeded. The desktop's Synchronization view signs in, reviews enrollment or joins an existing cloud company.

Device saves and cloud acceptance are distinct. Synchronized posting uses signed permissions lasting at most **24 hours**; expiration retains read/backup. Shared masters require an online service. Local-only companies stay independent. SQLite is unencrypted: protect the Windows account/device and keep separately encrypted backups. Restores require explicit cloud reconciliation. Read the [sync](docs/architecture/offline-sync.md) and [security](docs/architecture/security.md) limits before deployment.

For the browser app, run `npm.cmd run web:build` then `npm.cmd run web:start` from this directory and open **http://127.0.0.1:3000**. The separate accounting API is optional for local-only work; start it with `npm.cmd run api:start` for synchronization. The server-only `ERP_API_ORIGIN` defaults to http://127.0.0.1:4318 and accepts HTTPS or literal loopback HTTP. It contains no database credentials. `npm.cmd run web:dev` provides online development; offline reopening requires the production build and a successfully installed public-shell worker.

Use the same origin and browser profile to reopen offline. IndexedDB is plaintext, best-effort storage, including when persistence is granted; private windows, clearing site data or browser eviction can erase it. Export encrypted **ERPWEB01** backups outside the browser and confirm the downloaded file exists. Restore browser backups in Backup & recovery after creating/unlocking a vault; if storage disappeared, create a temporary vault first, then replace it with the backup and unlock using its original device password. Browser and Windows ERPBAK01 backup formats differ; use cloud synchronization to share companies. Close all workspace tabs and reopen when an app update is waiting. Safari, mobile browsers and insecure non-loopback HTTP are outside current supported/tested modes.

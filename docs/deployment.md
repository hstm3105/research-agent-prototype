# ResearchOS Deployment Guide

This guide describes how to run ResearchOS locally or deploy it to a Node-compatible production environment. The project uses a React/Vite client bundled together with an Express/tRPC server, a MySQL-compatible database, Manus OAuth, Gemini, Tavily, Google Workspace APIs, and S3-compatible storage.

## Deployment checklist

Before deploying, confirm that the target environment provides Node.js 22 or a compatible current Node runtime, pnpm, a MySQL/TiDB database, HTTPS, and a process manager or platform that can run the compiled Node server. The application must be reachable over HTTPS for Manus OAuth and Google Workspace OAuth callbacks.

| Area | Required action |
|---|---|
| Runtime | Install dependencies, run the production build, and start `dist/index.js`. |
| Database | Provide `DATABASE_URL`, then run `pnpm db:push` against the intended database. |
| Authentication | Configure the Manus OAuth values supplied by the deployment environment. |
| AI and retrieval | Provide `GEMINI_API_KEY` and `TAVILY_API_KEY` server-side. |
| Google exports | Configure Google APIs, OAuth credentials, and the production callback URI. |
| Storage | Provide the Manus Forge/S3 environment values required by the storage helpers. |
| Security | Use HTTPS, a high-entropy `JWT_SECRET`, and never commit `.env` files or API keys. |

## Environment variables

The following values are application or integration settings. Keep all secrets in the deployment platform’s secret manager rather than in the repository.

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | MySQL/TiDB connection string. |
| `JWT_SECRET` | Yes | Signs the application session and derives the encryption key for stored Google tokens. Rotating it invalidates existing sessions and stored Google authorization data. |
| `GEMINI_API_KEY` | Yes | Server-only Gemini credential for planning, research analysis, and synthesis. |
| `TAVILY_API_KEY` | Yes | Server-only Tavily credential for general public-web retrieval. |
| `GOOGLE_OAUTH_CLIENT_ID` | For Google exports | Google OAuth 2.0 client ID. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | For Google exports | Google OAuth 2.0 client secret. |
| `RESEARCHOS_PUBLIC_URL` | Recommended | Canonical HTTPS origin used to construct the Google callback when forwarded host headers are unavailable. |
| `OAUTH_SERVER_URL` | Manus deployment | Manus OAuth server base URL. |
| `VITE_APP_ID` | Manus deployment | Manus OAuth application ID. |
| `VITE_OAUTH_PORTAL_URL` | Manus deployment | Frontend Manus login portal URL. |
| `BUILT_IN_FORGE_API_URL` | Manus deployment | Manus internal API base URL for storage and platform services. |
| `BUILT_IN_FORGE_API_KEY` | Manus deployment | Server-side Manus internal API credential. |
| `VITE_FRONTEND_FORGE_API_URL` | Manus deployment | Frontend-safe Manus API URL. |
| `VITE_FRONTEND_FORGE_API_KEY` | Manus deployment | Frontend-safe Manus API credential where required by the template. |
| `OWNER_OPEN_ID`, `OWNER_NAME` | Manus deployment | Owner metadata used by the application template. |

`server/_core/env.ts` is the authoritative application environment shim. Do not expose server-only values through client code or Vite-prefixed variables.

## Google Workspace OAuth setup

1. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Drive API**, **Google Docs API**, **Google Sheets API**, and **Google Slides API**.
3. Configure the OAuth consent screen and add the intended test users while the consent screen remains in testing mode.
4. Create a Web application OAuth client.
5. Add the exact production callback as an authorized redirect URI:

   ```text
   https://<production-domain>/api/integrations/google/callback
   ```

6. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the deployment secret manager.
7. Sign in to ResearchOS, open a completed research brief, select **Connect Google**, and complete authorization.
8. Verify all three destinations: **Decision brief** creates a Google Doc, **Evidence matrix** creates a Google Sheet, and **Decision deck** creates a Google Slides presentation.

ResearchOS stores OAuth tokens encrypted with an AES-256-GCM key derived from `JWT_SECRET`. The database stores token ciphertext and export metadata, not plaintext access tokens.

## Database migrations

The repository uses Drizzle ORM. Generate and apply migrations against the configured database with:

```bash
pnpm install
pnpm db:push
```

For a production migration workflow, take a database backup first, review generated SQL, apply it to a staging database, run the application checks, and then apply it to production. The schema includes research sessions, plans, sources, findings, citations, exports, share links, recommendation options, provider rate limits, and Google Workspace connections/exports.

## Local development

```bash
pnpm install
pnpm db:push
pnpm run dev
```

The development server starts the Express/tRPC API and Vite client from `server/_core/index.ts`. Do not hardcode a port in application code; the managed environment supplies the runtime port.

## Production build

```bash
pnpm install --frozen-lockfile
pnpm db:push
pnpm run check
pnpm test
pnpm run build
pnpm run start
```

The build creates the Vite client output and bundles the server into `dist/index.js`. The production process is:

```bash
NODE_ENV=production node dist/index.js
```

Use the hosting platform’s HTTPS domain as the public origin. Configure health monitoring against the application root and review server logs after startup. The repository does not require a custom Dockerfile for the default Node deployment.

## Validation commands

Run the deterministic suite before every release:

```bash
pnpm run check
pnpm test
```

Provider-backed tests are intentionally opt-in so the default suite does not consume external quotas. Use the relevant environment flag only when live credentials and quota are available. Examples include:

```bash
RUN_TAVILY_CREDENTIAL_TEST=1 pnpm vitest run server/research/tavilyCredential.test.ts
RUN_GEMINI_LIVE_TEST=1 pnpm vitest run server/research/geminiLiveRecommendation.test.ts
```

Local venue recommendations use the Maps-first route when eligible. Gemini Google Search grounding through `/v1beta/interactions` remains a separate provider path and may be unavailable when the Google project has no grounding quota.

## Operational notes

Research execution is streamed to the browser through server-sent events. The Gemini adapter uses a shared database-backed request governor capped below the observed provider RPM limit and records non-secret provider attempt telemetry. A provider limit does not delete the user’s plan, sources, findings, or lifecycle state; the UI presents a recoverable preserved-work state.

Tavily is the general public-web retrieval provider. Google Maps Places is used for eligible local venue evidence. Public video is retained only as a bounded fallback. Every retained finding should link to its underlying source, and completed sessions can be exported as Markdown, print-ready HTML, Google Docs, Google Sheets, or Google Slides.

## Troubleshooting

| Symptom | Checks |
|---|---|
| Google returns to an error page | Confirm the callback URI matches exactly, including scheme, host, and path. |
| Google export says authorization is unavailable | Confirm both OAuth secrets are present and `JWT_SECRET` has not changed since authorization. |
| Research enters preserved-work recovery | Inspect provider diagnostics and confirm Gemini quota, key validity, and RPM governor state. Do not remove retained work. |
| General web sources are absent | Check `TAVILY_API_KEY`, the official attribution headers in the Tavily adapter, and the server logs. |
| Local recommendations are thin | Confirm Maps Places is available; use **Broaden Scope** rather than presenting unsupported claims. |
| Browser shows a failed fetch | Check the API server health, authenticated session cookie, browser console, network status, and server logs together. |
| Migration fails | Verify `DATABASE_URL`, review the generated SQL, and check whether a partial migration was applied before retrying. |

## Security expectations

Never commit `.env` files, API keys, OAuth client secrets, refresh tokens, access tokens, or exported research containing private user data. Keep the GitHub repository public only for source code that is safe to disclose. Production deployments should use least-privilege service credentials, HTTPS, encrypted secret storage, database backups, and a documented rotation process.

## Maintainer-only live export validator

The repository includes `scripts/validateGoogleWorkspaceExports.mjs` for an authorized, completed session. It creates one fresh Doc, Sheet, and Slides export and prints their URLs:

```bash
pnpm tsx scripts/validateGoogleWorkspaceExports.mjs <completed-session-id> <user-id>
```

Run this only in an authenticated environment with the user’s explicit approval, because it creates real files in that user’s Google Drive.

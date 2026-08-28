# ResearchOS — Agentic Research Workspace

**ResearchOS** is an AI-powered deep research agent that autonomously conducts structured, multi-source research. It interprets natural-language questions, builds adaptive research plans, retrieves public evidence, synthesizes a decision-ready answer, and exports the result into editable Google Workspace deliverables.

> ResearchOS is designed to make research work visible: the user can see what the agent is trying to learn, which sources it retained, how the evidence supports each finding, and how the final answer can be reused.

## Product capabilities

- **Intent-aware intake:** Parses a natural-language query into a research goal, intent, depth, clarification state, and suitable output format.
- **Adaptive planning:** Creates ordered research steps and can revise pending work when new evidence changes the shape of the question.
- **Multi-source retrieval:** Uses Tavily for general public-web evidence, Google Maps Places for eligible local venue research, and public video only as a bounded fallback.
- **Evidence-first synthesis:** Retains publishers, excerpts, retrieval metadata, quality signals, finding-level citations, and source links.
- **Decision-ready recommendations:** Produces ranked options with explicit criteria, strengths, caveats, source-backed evidence, and selection advice when the query is recommendation-oriented.
- **Real-time workspace:** Streams lifecycle phases, plan progress, source discovery, findings, recovery states, and completion through server-sent events.
- **Research history:** Keeps user-scoped sessions searchable with depth labels, status indicators, and intentional saved-session navigation.
- **Resilience:** Preserves work during AI-service limits, uses a database-backed Gemini request governor, and prevents duplicate research runs from reconnecting streams.
- **Editable decision deliverables:** Exports completed research into Google Docs, Sheets, and Slides with native formatting and per-source traceability. Markdown and print-ready HTML exports are stored through S3-backed storage.
- **Shareable briefs:** Supports revocable, tokenized, read-only brief links that expose only the completed evidence bundle.

## Architecture

ResearchOS has a React/Vite client and an Express/tRPC server in one deployable Node application. Authenticated requests are handled through Manus OAuth and protected tRPC procedures. Research execution runs server-side so provider credentials remain private. The browser subscribes to `/api/research/stream/:sessionId` for live progress while research artifacts are persisted in the database.

```text
User query
   │
   ▼
React workspace ── tRPC ── Express server
                               │
               ┌───────────────┼────────────────┐
               ▼               ▼                ▼
        Gemini planning   Public retrieval   Artifact builder
        and synthesis     Tavily / Maps      citations + outputs
               │               │                │
               └───────────────┼────────────────┘
                               ▼
                  MySQL/TiDB + S3-backed exports
                               │
                               ▼
                  Google Docs / Sheets / Slides
```

### Evidence routing

| Research need | Primary route | Purpose |
|---|---|---|
| General public-web research | Tavily Search | Normalized titles, URLs, publishers, and excerpts from public sources. |
| Local venues and places | Google Maps Places | Named candidates with attributable Maps links and local evidence. |
| Visual or instructional fallback | Public video | Bounded fallback when another public source is unavailable. |
| Reasoning and synthesis | Gemini Flash-Lite | Intent parsing, planning, evidence analysis, recommendations, and final synthesis. |

## Technology

- **Frontend:** React 19, Vite, Tailwind CSS 4, tRPC 11, Radix UI, and Shadcn UI patterns.
- **Backend:** Express 4, TypeScript, Drizzle ORM, MySQL/TiDB, and server-sent events.
- **LLM:** `gemini-3.5-flash-lite` as the primary model and `gemini-3.1-flash-lite` as the model-level fallback.
- **Authentication:** Manus OAuth 2.0 with protected server procedures.
- **Storage:** S3-compatible storage through the provided Manus storage helpers.
- **Integrations:** Tavily Search, Google Maps Places, Google Drive/Docs/Sheets/Slides APIs.
- **Testing:** Vitest with jsdom and Testing Library coverage for server contracts and rendered flows.

## Quick start

```bash
pnpm install
pnpm db:push
pnpm run dev
```

The development server starts the Express/tRPC API and Vite client. The runtime port is supplied by the environment; application code should not hardcode one.

## Environment configuration

At minimum, a self-managed deployment needs a MySQL/TiDB `DATABASE_URL`, a high-entropy `JWT_SECRET`, `GEMINI_API_KEY`, and `TAVILY_API_KEY`. Google exports additionally require `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. Manus-hosted deployments also provide the OAuth, Forge API, and owner environment values described in [`docs/deployment.md`](docs/deployment.md).

Never commit `.env` files, API keys, OAuth secrets, access tokens, refresh tokens, or private exported research. Server-only values must remain outside the client bundle.

## Build and test

```bash
pnpm run check       # TypeScript validation
pnpm test            # Deterministic regression suite
pnpm run format      # Prettier formatting
pnpm run build       # Vite client + bundled Node server
pnpm run start       # Start dist/index.js in production mode
```

Provider-backed tests are intentionally opt-in so the default suite does not consume external quota. Examples:

```bash
RUN_TAVILY_CREDENTIAL_TEST=1 pnpm vitest run server/research/tavilyCredential.test.ts
RUN_GEMINI_LIVE_TEST=1 pnpm vitest run server/research/geminiLiveRecommendation.test.ts
```

The Gemini Google Search-grounding path can remain unavailable when a Google project has no `/v1beta/interactions` quota. Local venue recommendations use the Maps-first route instead of depending on that path.

## Deployment

For the full production checklist, secret reference, Google OAuth setup, database migration workflow, validation commands, operational notes, and troubleshooting matrix, read [`docs/deployment.md`](docs/deployment.md). For the release audit and prioritized maintainer cleanup recommendations, read [`docs/repository-audit.md`](docs/repository-audit.md).

The normal production sequence is:

```bash
pnpm install --frozen-lockfile
pnpm db:push
pnpm run check
pnpm test
pnpm run build
NODE_ENV=production pnpm run start
```

For Google Workspace exports, register the exact callback URL `https://<production-domain>/api/integrations/google/callback`, enable the Google Drive, Docs, Sheets, and Slides APIs, authorize the user from a completed ResearchOS brief, and verify all three editable destinations.

## Repository map

| Path | Responsibility |
|---|---|
| `client/src/pages/Home.tsx` | Main intake, research workspace, progress view, results, history, and export controls. |
| `server/research/agent.ts` | Intent parsing, adaptive planning, sequential execution, evidence persistence, and final synthesis. |
| `server/research/llmProvider.ts` | Gemini request shaping, model fallback, rate governance, and provider diagnostics. |
| `server/research/search.ts` | Tavily public-web retrieval and bounded source fallback behavior. |
| `server/research/places.ts` | Google Maps Places retrieval for local recommendation evidence. |
| `server/research/decisionArtifact.ts` | Canonical decision artifact shared by export renderers. |
| `server/research/workspaceTemplates.ts` | Docs, Sheets, and Slides content and formatting contracts. |
| `server/integrations/googleWorkspace.ts` | Per-user Google OAuth, encrypted token handling, and Google API export requests. |
| `drizzle/schema.ts` | Relational schema for users, sessions, plans, evidence, exports, shares, rate limits, and Workspace connections. |
| `scripts/validateGoogleWorkspaceExports.mjs` | Maintainer-only live validator that creates fresh exports for an authorized completed session. |
| `docs/deployment.md` | Detailed deployment, integration, security, and troubleshooting guide. |
| `docs/repository-audit.md` | Public-release audit and prioritized cleanup recommendations. |

## Current release notes

The public repository includes the ResearchOS decision-artifact foundation, Tavily general-web retrieval, Maps-first local recommendations, resilient Gemini execution, editable Google Workspace exports, refreshed export formatting, and regression coverage for the major user flows. The only intentionally deferred validations concern Gemini Google Search grounding through `/v1beta/interactions` when the provider project has no available quota.

ResearchOS is built by **Manus AI** and released under the repository’s MIT license.

## License

This project is licensed under the [MIT License](LICENSE).

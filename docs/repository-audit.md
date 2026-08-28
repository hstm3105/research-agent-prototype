# ResearchOS Repository Audit

## Audit result

The public repository is aligned with the latest ResearchOS project state at commit `4d59dc8`. The latest source includes the agentic research pipeline, Gemini provider adapter and rate governor, Tavily and Maps retrieval, decision artifacts, Google Workspace exports, refreshed export formatting, tests, the comprehensive README, the deployment guide, and the MIT license. The local `main` branch and `origin/main` resolve to the same commit after the documentation release.

The repository contains no committed `.env` file or detected literal API key. Secret names appear in code and documentation only as configuration references or test fixtures. The public repository should continue to be treated as source-code-only: do not add generated exports, OAuth tokens, database dumps, screenshots containing private research, or local build artifacts.

## Current structure

| Area | Current responsibility | Assessment |
|---|---|---|
| `client/src/pages` and `client/src/components` | Research intake, workspace, history, recovery, and exports | Coherent for the current prototype; keep page-level orchestration from growing further. |
| `server/research` | Intent, planning, retrieval, evidence quality, synthesis, and artifact construction | Strong domain boundary; the agent orchestrator is now the largest maintenance surface. |
| `server/integrations` | Google OAuth and Workspace file creation | Correctly separated from research logic; API request builders can be extracted further. |
| `server/db.ts` and `drizzle/schema.ts` | Persistence helpers and relational model | Centralized and understandable; typed JSON fields need a versioning convention as the product expands. |
| `scripts` | Maintainer-only live validation utilities | Useful, but each script should state its side effects and required authorization. |
| `docs` | Deployment and maintainer documentation | Suitable for a public repository; keep provider research notes out of the top-level surface. |

## Recommended cleanup, prioritized

### Priority 1 — Reduce large-module coupling

Split `server/research/agent.ts` into smaller modules for intent parsing, plan adaptation, execution, and synthesis. Move the large JSON schemas into a dedicated `researchSchemas.ts` module and keep the orchestrator focused on lifecycle transitions. Split `server/integrations/googleWorkspace.ts` into OAuth/token management, typed Google API clients, and destination-specific renderers. This would make provider changes safer and reduce the chance that a formatting change affects authorization behavior.

### Priority 2 — Version structured persistence

Several database columns intentionally store serialized JSON, including plan, provider diagnostics, quality signals, recommendation facts, and citation IDs. Introduce small typed serializers/parsers with a version field and centralized validation. This will make migrations and backward-compatible reads safer than parsing each field ad hoc as new artifact fields are introduced.

### Priority 3 — Tighten runtime configuration

Add a production startup validation step that reports missing mandatory configuration without printing secret values. Keep the canonical public URL in deployment configuration rather than relying on a product-specific fallback in application code. Document which variables are supplied by Manus infrastructure and which are user-managed integration secrets.

### Priority 4 — Add continuous integration

Add a GitHub Actions workflow that runs `pnpm install --frozen-lockfile`, `pnpm run check`, `pnpm test`, and `pnpm run build` on pull requests and pushes to `main`. Keep live provider tests opt-in and excluded from ordinary CI unless a separate protected environment is configured.

### Priority 5 — Reduce client bundle cost

The production build reports chunks larger than 500 kB. Use route-level and feature-level dynamic imports for heavy visualization, diagram, and editor dependencies, then configure Vite manual chunks if needed. Measure the resulting initial JavaScript payload before and after the change rather than optimizing based on warning text alone.

### Priority 6 — Expand contract and integration coverage

Add API-request contract tests for the Sheets and Slides batch-update payloads, not only the Docs formatter. Add a non-provider integration test that validates the complete canonical-artifact-to-renderer mapping for empty evidence, sparse evidence, recommendations, and source-only sessions. Keep live Google export validation behind an explicit flag because it creates real files.

### Priority 7 — Add public contributor hygiene

Add a `.env.example` containing variable names only, a contribution guide describing the test and formatting commands, and a security policy explaining how to report accidentally committed secrets. Confirm that generated build output and local logs remain excluded from version control.

## Deferred provider validation

Three backlog items remain intentionally open because the configured Gemini project previously returned HTTP 429 for `/v1beta/interactions`: a successful grounded Jaipur shortlist, a typed Gemini-grounded multi-option shortlist, and one successful governed grounded request. These are external-quota validations rather than repository defects. The Maps-first local route and standard Gemini generation path remain the working production path for local recommendation research.

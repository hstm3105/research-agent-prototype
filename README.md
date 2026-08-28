# ResearchOS — Agentic Research Workspace

**ResearchOS** is an AI-powered deep research agent that autonomously conducts structured, multi-source research. It understands complex user queries, builds adaptive research plans, executes them using LLM reasoning and live public web sources, and presents cited findings in a decision-ready workspace.

## 🚀 Core Features

- **Intent-Aware Research:** Parses natural language queries to define research objectives and select optimal output formats.
- **Adaptive Planning:** Generates multi-step research plans that evolve based on discovered evidence.
- **Multi-Source Retrieval:**
  - **Tavily:** General public-web evidence and articles.
  - **Google Maps Places:** Local venue evidence and attributable Maps links.
  - **Public Video:** Bounded fallback for visual or instructional content.
- **Structured Recommendations:** Ranked shortlists with decision criteria, trade-offs, and source-backed evidence.
- **Real-Time Streaming:** Live visualization of planning, activity logs, and intermediate findings via SSE.
- **Decision Deliverables:** One-click export to editable **Google Docs**, **Sheets**, and **Slides** with native formatting and source traceability.
- **AI-Service Resilience:** Built-in RPM governor and graceful recovery from provider quota limits.

## 🛠 Tech Stack

- **Frontend:** React 19, Tailwind CSS 4, tRPC 11, Shadcn UI, Vite
- **Backend:** Express 4, Drizzle ORM, MySQL/TiDB, tsx
- **LLM:** Gemini 3.5 Flash-Lite (Primary) & Gemini 3.1 Flash-Lite (Fallback)
- **Auth:** Manus OAuth 2.0
- **Storage:** AWS S3 (via Manus Storage)
- **Testing:** Vitest with jsdom environment

## 📋 Deployment & Setup

### 1. Environment Configuration

ResearchOS requires the following environment variables. In production, ensure these are set in your hosting environment.

| Variable | Description | Source |
|---|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key. | [Google AI Studio](https://aistudio.google.com/) |
| `TAVILY_API_KEY` | Tavily Search API key. | [Tavily](https://tavily.com/) |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth 2.0 Client ID. | [Google Cloud Console](https://console.cloud.google.com/) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth 2.0 Client Secret. | [Google Cloud Console](https://console.cloud.google.com/) |
| `JWT_SECRET` | Secret for session signing and token encryption. | User-defined |
| `DATABASE_URL` | MySQL/TiDB connection string. | Database Provider |
| `RESEARCHOS_PUBLIC_URL` | The public URL of your deployment. | Deployment |

### 2. Google Workspace Integration

1.  **Project Setup**: Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2.  **APIs**: Enable **Google Drive API**, **Google Docs API**, **Google Sheets API**, and **Google Slides API**.
3.  **OAuth**: Configure the OAuth Consent Screen and create **OAuth 2.0 Client Credentials**.
4.  **Redirect URI**: Add `https://<your-domain>/api/integrations/google/callback` to the Authorized Redirect URIs.

### 3. Installation & Local Development

```bash
# Install dependencies
pnpm install

# Apply database migrations
pnpm db:push

# Start development server
pnpm run dev
```

### 4. Build & Production

```bash
# Build for production
pnpm run build

# Start production server
pnpm run start
```

### 5. Testing & Quality

```bash
# Run all tests
pnpm test

# Run type check
pnpm run check

# Run formatting
pnpm run format
```

## 🏗 Project Structure

- `client/src/pages/Home.tsx`: Main research workspace and intake flow.
- `server/research/agent.ts`: Core research orchestration and adaptive planning.
- `server/research/llmProvider.ts`: Gemini adapter with RPM governor and fallback.
- `server/integrations/googleWorkspace.ts`: Google Workspace export rendering logic.
- `server/research/workspaceTemplates.ts`: Decision-deliverable template definitions.
- `drizzle/schema.ts`: Database schema definitions.

---

**ResearchOS** is built by **Manus AI**.

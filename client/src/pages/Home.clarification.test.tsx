// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidateGet: vi.fn().mockResolvedValue(undefined),
  invalidateList: vi.fn().mockResolvedValue(undefined),
  clarify: vi.fn().mockResolvedValue(undefined),
  broaden: vi.fn().mockResolvedValue({ id: "broader-session" }),
  createShare: vi.fn().mockResolvedValue({ id: "share-1", token: "secure-shared-brief-token-1234567890" }),
  revokeShare: vi.fn().mockResolvedValue({ id: "active-share", revoked: true }),
  completedMode: false,
  emptyFindingMode: false,
  limitMode: false,
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children, onSelectSession, onNewResearch }: { children: React.ReactNode; onSelectSession?: (id: string) => void; onNewResearch?: () => void }) => <div><button onClick={() => onSelectSession?.("session-live")}>Open active session</button><button onClick={onNewResearch}>New research navigation</button>{children}</div>,
}));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} /> }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ research: { get: { invalidate: mocks.invalidateGet }, list: { invalidate: mocks.invalidateList } } }),
    research: {
      list: { useQuery: () => ({ data: [{ id: "session-live", title: "Active brief", status: mocks.completedMode ? "complete" : mocks.limitMode ? "failed" : "draft", researchDepth: "standard", updatedAt: new Date() }], isLoading: false, error: null, refetch: vi.fn() }) },
      get: { useQuery: () => ({ data: { session: { id: "session-live", title: "Active brief", query: "Research a topic", researchGoal: "Research a topic", outputFormat: "report", status: mocks.completedMode ? "complete" : mocks.limitMode ? "failed" : "draft", finalOutput: mocks.completedMode ? "# Active brief\n\nA completed source-backed research summary." : null, errorMessage: mocks.limitMode ? "AI_SERVICE_LIMIT" : null, lifecyclePhase: mocks.limitMode ? "planning" : null, lifecycleProgress: mocks.limitMode ? 18 : null, lifecycleMessage: mocks.limitMode ? "Research safely paused during planning. Collected work remains available to resume." : null }, steps: mocks.completedMode ? [{ id: "step-1", ordinal: 0, title: "Sparse source check", description: "Check evidence", searchQuery: "research topic", status: "skipped" }] : [], sources: mocks.completedMode ? [{ id: "source-1", title: "Institutional evidence", url: "https://example.gov/evidence", publisher: "Evidence Office", excerpt: "A substantive source excerpt used by the research brief.", qualityScore: 82, qualitySignalsJson: JSON.stringify(["Primary or institutional domain", "Cited by 1 finding"]), citationCount: 1, retrievedAt: new Date() }] : [], findings: mocks.completedMode && !mocks.emptyFindingMode ? [{ id: "finding-1", ordinal: 0, title: "Cited finding", claim: "Evidence points to a clear conclusion.", evidence: "Supporting evidence.", citationSourceIdsJson: JSON.stringify(["source-1"]) }] : [], exports: [], shareLinks: mocks.completedMode ? [{ id: "active-share", createdAt: new Date(), revokedAt: null }] : [] }, isLoading: false, error: null, refetch: vi.fn() }) },
      create: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      clarify: { useMutation: () => ({ isPending: false, mutateAsync: mocks.clarify }) },
      export: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      broaden: { useMutation: () => ({ isPending: false, mutateAsync: mocks.broaden }) },
      createShareLink: { useMutation: () => ({ isPending: false, mutateAsync: mocks.createShare }) },
      revokeShareLink: { useMutation: () => ({ isPending: false, mutateAsync: mocks.revokeShare }) },
    },
  },
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  readyState = 1;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(_url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  close() { this.readyState = FakeEventSource.CLOSED; }
  emit(type: string, data: unknown) { this.listeners.get(type)?.forEach(listener => listener(new MessageEvent(type, { data: JSON.stringify(data) }))); }
}

import Home from "./Home";

describe("Home active-session clarification flow", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completedMode = false;
    mocks.emptyFindingMode = false;
    mocks.limitMode = false;
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("renders a streamed clarification immediately and resumes the active stream after submission", async () => {
    const user = userEvent.setup();
    render(<Home />);

    expect(screen.getByPlaceholderText(/What do you need to understand/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /open active session/i }));
    expect(FakeEventSource.instances).toHaveLength(0);
    await user.click(await screen.findByRole("button", { name: /run research/i }));
    expect(FakeEventSource.instances).toHaveLength(1);
    await act(async () => {
      FakeEventSource.instances[0].emit("activity", { type: "activity", phase: "discovering", message: "Checking live public sources.", progress: 32 });
    });
    const lifecyclePanel = await screen.findByLabelText("Research lifecycle health");
    expect(within(lifecyclePanel).getByText(/discovering/i)).toBeTruthy();
    expect(within(lifecyclePanel).getByText("32%")).toBeTruthy();
    await act(async () => {
      FakeEventSource.instances[0].emit("clarification", { type: "clarification", sessionId: "session-live", question: "Which jurisdiction applies?" });
    });

    expect(await screen.findByText("Which jurisdiction applies?")).toBeTruthy();
    expect(mocks.invalidateGet).toHaveBeenCalledWith({ sessionId: "session-live" });

    await user.type(screen.getByPlaceholderText(/Add the constraint/i), "India");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(mocks.clarify).toHaveBeenCalledWith({ sessionId: "session-live", answer: "India" });
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("returns to the fresh composer when New Research is chosen", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: /open active session/i }));
    expect(await screen.findByRole("button", { name: /run research/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /new research navigation/i }));

    expect(await screen.findByPlaceholderText(/What do you need to understand/i)).toBeTruthy();
    expect(screen.getByLabelText("Research depth")).toBeTruthy();
  });

  it("clears an explicit session URL when New Research is chosen", async () => {
    window.history.replaceState({}, "", "/?session=session-live");
    const user = userEvent.setup();
    render(<Home />);

    expect(await screen.findByRole("button", { name: /run research/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /new research navigation/i }));

    expect(window.location.search).toBe("");
    expect(await screen.findByPlaceholderText(/What do you need to understand/i)).toBeTruthy();
  });

  it("offers a preserved-work recovery flow for an AI service limit", async () => {
    mocks.limitMode = true;
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: /open active session/i }));
    expect(await screen.findByText("Research safely paused")).toBeTruthy();
    expect(screen.getByText(/question, research plan, collected sources, and cited findings are saved/i)).toBeTruthy();
    const recoveryPanel = screen.getByLabelText("AI service recovery");
    expect(within(recoveryPanel).getByLabelText("Paused recovery phase").textContent).toBe("planning");
    expect(within(recoveryPanel).getByLabelText("Paused recovery progress").textContent).toBe("18%");
    expect(within(recoveryPanel).getByText(/Collected work remains available to resume/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /resume research/i }));
    expect(FakeEventSource.instances).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: /start new research/i }));
    expect(await screen.findByPlaceholderText(/What do you need to understand/i)).toBeTruthy();
  });

  it("keeps a dual-provider outage in the preserved-work recovery panel without provider diagnostics", async () => {
    mocks.limitMode = true;
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: /open active session/i }));
    expect(await screen.findByLabelText("AI service recovery")).toBeTruthy();
    expect(screen.queryByText(/Gemini invoke failed|AI_PROVIDERS_UNAVAILABLE/i)).toBeNull();
  });

  it("offers sparse-evidence broadening, transparent source signals, and revocable sharing on a completed brief", async () => {
    mocks.completedMode = true;
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: /open active session/i }));
    expect(await screen.findByText(/Evidence coverage is limited/i)).toBeTruthy();
    expect(screen.getByText("High signal")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /share read-only brief/i }));
    expect(mocks.createShare).toHaveBeenCalledWith({ sessionId: "session-live" });
    expect(await screen.findByText(/New read-only link/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(mocks.revokeShare).toHaveBeenCalledWith({ id: "active-share" });

    await user.click(screen.getByRole("button", { name: /broaden scope/i }));
    expect(mocks.broaden).toHaveBeenCalledWith({ sessionId: "session-live" });
  });

  it("shows a completed source-backed brief when a session has sources but no cited findings", async () => {
    mocks.completedMode = true;
    mocks.emptyFindingMode = true;
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: /open active session/i }));

    expect(await screen.findByText("What the evidence suggests")).toBeTruthy();
    expect(screen.getByLabelText("Source-backed research output")).toBeTruthy();
    expect(screen.getByText("Evidence collected for review")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Institutional evidence" })).toHaveProperty("href", "https://example.gov/evidence");
  });
});

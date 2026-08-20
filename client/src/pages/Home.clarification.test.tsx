// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidateGet: vi.fn().mockResolvedValue(undefined),
  invalidateList: vi.fn().mockResolvedValue(undefined),
  clarify: vi.fn().mockResolvedValue(undefined),
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
      list: { useQuery: () => ({ data: [{ id: "session-live", title: "Active brief", status: "draft", updatedAt: new Date() }], isLoading: false, error: null, refetch: vi.fn() }) },
      get: { useQuery: () => ({ data: { session: { id: "session-live", title: "Active brief", query: "Research a topic", researchGoal: "Research a topic", outputFormat: "report", status: "draft", errorMessage: null }, steps: [], sources: [], findings: [], exports: [] }, isLoading: false, error: null, refetch: vi.fn() }) },
      create: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      clarify: { useMutation: () => ({ isPending: false, mutateAsync: mocks.clarify }) },
      export: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
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
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
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
});

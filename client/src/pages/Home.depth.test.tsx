// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ id: "new-depth-session" }),
  invalidateGet: vi.fn().mockResolvedValue(undefined),
  invalidateList: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock("@/components/ui/textarea", () => ({ Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} /> }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) => <select aria-label="Research depth" value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value }: { value: string; children: React.ReactNode }) => <option value={value}>{value}</option>,
}));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ research: { get: { invalidate: mocks.invalidateGet }, list: { invalidate: mocks.invalidateList } } }),
    research: {
      list: { useQuery: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }) },
      get: { useQuery: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }) },
      create: { useMutation: () => ({ isPending: false, mutateAsync: mocks.create }) },
      clarify: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
      export: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
    },
  },
}));

class FakeEventSource {
  static readonly CLOSED = 2;
  readyState = 1;
  onerror: ((event: Event) => void) | null = null;
  addEventListener() {}
  close() { this.readyState = FakeEventSource.CLOSED; }
}

import Home from "./Home";

describe("Home research-depth intake", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("EventSource", FakeEventSource); });

  it("offers depth choices and sends Deep Dive with the new query", async () => {
    const user = userEvent.setup();
    render(<Home />);

    await user.selectOptions(screen.getByLabelText("Research depth"), "deep");
    await user.type(screen.getByPlaceholderText(/What do you need to understand/i), "Compare renewable energy storage approaches");
    await user.click(screen.getByRole("button", { name: /start research/i }));

    expect(mocks.create).toHaveBeenCalledWith({ query: "Compare renewable energy storage approaches", researchDepth: "deep" });
  });
});

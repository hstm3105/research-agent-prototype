/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ available: true }));

vi.mock("@/components/ui/button", () => ({ Button: ({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => <button {...props}>{children}</button> }));
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("wouter", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>, useParams: () => ({ token: "valid-shared-brief-token-1234567890" }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    research: {
      sharedBrief: {
        useQuery: () => ({
          isLoading: false,
          data: mocks.available ? {
            publishedAt: new Date("2026-08-21T00:00:00.000Z"),
            session: { id: "shared-session", title: "Shared evidence brief", query: "Assess the evidence", researchGoal: "Assess the evidence", outputFormat: "report", finalOutput: "# Shared evidence brief", completedAt: new Date("2026-08-21T00:00:00.000Z") },
            steps: [],
            sources: [{ id: "source-1", title: "Institutional research", url: "https://example.gov/research", publisher: "Evidence Office", excerpt: "A substantive excerpt from the public source.", qualityScore: 82, qualitySignalsJson: JSON.stringify(["Primary or institutional domain", "Cited by 1 finding"]), citationCount: 1, retrievedAt: new Date() }],
            findings: [{ id: "finding-1", title: "Cited conclusion", claim: "The evidence points to a clear conclusion.", evidence: "The public source supports this conclusion.", citationSourceIdsJson: JSON.stringify(["source-1"]) }],
            citations: [],
          } : null,
        }),
      },
    },
  },
}));

import SharedBrief from "./SharedBrief";

describe("SharedBrief", () => {
  beforeEach(() => { mocks.available = true; });
  afterEach(() => cleanup());

  it("renders a read-only completed brief with cited findings and source-signal labels", () => {
    render(<SharedBrief />);

    expect(screen.getByText("Read-only shared brief")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Shared evidence brief" })).toBeTruthy();
    expect(screen.getByText("Cited conclusion")).toBeTruthy();
    expect(screen.getByText("High signal")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Evidence Office/i }).some(link => link.getAttribute("href") === "https://example.gov/research")).toBe(true);
  });

  it("does not reveal a brief when the share token is unavailable", () => {
    mocks.available = false;
    render(<SharedBrief />);

    expect(screen.getByRole("heading", { name: "This brief is unavailable" })).toBeTruthy();
    expect(screen.queryByText("Shared evidence brief")).toBeNull();
  });
});

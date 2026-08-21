// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ loading: false, user: { name: "Researcher", email: "researcher@example.com" }, logout: vi.fn() }),
}));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));

import DashboardLayout from "./DashboardLayout";

describe("DashboardLayout searchable history", () => {
  afterEach(() => cleanup());

  it("filters saved sessions, shows depth labels, and reports an empty search", async () => {
    const user = userEvent.setup();
    render(<DashboardLayout sessions={[
      { id: "quick", title: "Battery policy brief", status: "complete", researchDepth: "quick", updatedAt: new Date() },
      { id: "deep", title: "Grid storage diligence", status: "researching", researchDepth: "deep", updatedAt: new Date() },
    ]}><div>Workspace</div></DashboardLayout>);

    expect(screen.getByText("Quick")).toBeTruthy();
    expect(screen.getByText("Deep")).toBeTruthy();
    await user.type(screen.getByLabelText("Search research history"), "grid");
    expect(screen.getByText("Grid storage diligence")).toBeTruthy();
    expect(screen.queryByText("Battery policy brief")).toBeNull();
    await user.clear(screen.getByLabelText("Search research history"));
    await user.type(screen.getByLabelText("Search research history"), "unmatched topic");
    expect(screen.getByText(/No saved research matches/i)).toBeTruthy();
  });
});

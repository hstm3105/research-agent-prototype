import { describe, expect, it, vi } from "vitest";
import { createTimeoutFetch } from "./trpcTransport";

describe("createTimeoutFetch", () => {
  it("aborts a hung API request instead of leaving the workspace in an indefinite loading state", async () => {
    vi.useFakeTimers();
    const stalledFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })) as unknown as typeof fetch;
    const timedFetch = createTimeoutFetch(1_000, stalledFetch);

    const request = timedFetch("/api/trpc/research.list");
    const rejection = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    vi.useRealTimers();
  });
});

export function createTimeoutFetch(
  timeoutMs = 15_000,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
) {
  return async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const controller = new AbortController();
    const externalSignal = init?.signal;
    const forwardAbort = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) forwardAbort();
    else externalSignal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = globalThis.setTimeout(() => controller.abort(new DOMException("Research API request timed out", "TimeoutError")), timeoutMs);
    try {
      return await fetchImplementation(input, { ...(init ?? {}), signal: controller.signal });
    } finally {
      globalThis.clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", forwardAbort);
    }
  };
}

import { describe, expect, it } from "vitest";

describe("Google OAuth client credentials", () => {
  it("are accepted by Google before the per-user authorization flow is enabled", async () => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(clientId).toBeTruthy();
    expect(clientSecret).toBeTruthy();

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId ?? "",
        client_secret: clientSecret ?? "",
        code: "researchos-credential-validation-placeholder",
        grant_type: "authorization_code",
        redirect_uri: "https://researchos-zcvsct26.manus.space/api/integrations/google/callback",
      }),
    });
    const payload = await response.json() as { error?: string };

    // A deliberately invalid authorization code must be rejected as a grant problem,
    // rather than an invalid OAuth client. No user token is created or requested here.
    expect(payload.error).not.toBe("invalid_client");
    expect([400, 401]).toContain(response.status);
  }, 30_000);
});

import { describe, expect, it } from "vitest";
import { createGoogleOauthState, googleAuthorizationUrl, verifyGoogleOauthState } from "./googleWorkspace";

describe("Google Workspace OAuth", () => {
  it("creates a signed, user-bound authorization state and rejects tampering", () => {
    const state = createGoogleOauthState(42);

    expect(verifyGoogleOauthState(state)).toEqual({ userId: 42 });
    expect(verifyGoogleOauthState(`${state}tampered`)).toBeNull();
  });

  it("requests only the workspace scopes needed for editable decision exports", () => {
    const authorizationUrl = new URL(googleAuthorizationUrl({ userId: 42, callbackUrl: "https://researchos-zcvsct26.manus.space/api/integrations/google/callback" }));

    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizationUrl.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/drive.file");
    expect(authorizationUrl.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/presentations");
    expect(verifyGoogleOauthState(authorizationUrl.searchParams.get("state") ?? "")).toEqual({ userId: 42 });
  });
});

import { describe, expect, it } from "vitest";
import { buildGoogleDocRequests, createGoogleOauthState, googleAuthorizationUrl, verifyGoogleOauthState } from "./googleWorkspace";

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

  it("constructs native Docs styles for headings, bullets, and linked source text", () => {
    const requests = buildGoogleDocRequests({
      title: "Formatted brief",
      body: "",
      blocks: [
        { kind: "title", text: "Formatted brief" },
        { kind: "heading", text: "Decision question" },
        { kind: "bullet", text: "Evidence-led option" },
        { kind: "sourceLink", text: "https://example.org/source", link: "https://example.org/source" },
      ],
    });

    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ updateParagraphStyle: expect.objectContaining({ paragraphStyle: { namedStyleType: "TITLE" } }) }),
      expect.objectContaining({ updateParagraphStyle: expect.objectContaining({ paragraphStyle: { namedStyleType: "HEADING_1" } }) }),
      expect.objectContaining({ createParagraphBullets: expect.any(Object) }),
      expect.objectContaining({ updateTextStyle: expect.objectContaining({ textStyle: expect.objectContaining({ link: { url: "https://example.org/source" } }) }) }),
    ]));
  });
});

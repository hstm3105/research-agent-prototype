import type { Express } from "express";
import { parse as parseCookieHeader } from "cookie";
import { googleCallbackUrl, storeGoogleAuthorization, verifyGoogleOauthState } from "./googleWorkspace";

const GOOGLE_STATE_COOKIE = "researchos_google_export_state";

export { GOOGLE_STATE_COOKIE };

export function registerGoogleWorkspaceOAuthRoutes(app: Express) {
  app.get("/api/integrations/google/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookieState = parseCookieHeader(req.headers.cookie || "")[GOOGLE_STATE_COOKIE];
    const statePayload = state && cookieState === state ? verifyGoogleOauthState(state) : null;
    if (!code || !statePayload) return res.redirect("/?google_export=failed");
    try {
      await storeGoogleAuthorization({ userId: statePayload.userId, code, callbackUrl: googleCallbackUrl(req) });
      res.clearCookie(GOOGLE_STATE_COOKIE, { path: "/" });
      return res.redirect("/?google_export=connected");
    } catch {
      return res.redirect("/?google_export=failed");
    }
  });
}

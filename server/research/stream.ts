import type { Express, Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { getResearchSessionForUser } from "../db";
import { runResearchSession } from "./agent";
import type { ResearchProgressEvent } from "./types";

function writeEvent(res: Response, event: ResearchProgressEvent) {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function registerResearchStream(app: Express) {
  app.get("/api/research/stream/:sessionId", async (req: Request, res: Response) => {
    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user) {
      res.status(401).json({ error: "Sign in is required to run research" });
      return;
    }
    const session = await getResearchSessionForUser(req.params.sessionId, user.id);
    if (!session) {
      res.status(404).json({ error: "Research session not found" });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    writeEvent(res, { type: "connected", sessionId: session.id });
    await runResearchSession({ sessionId: session.id, userId: user.id, emit: event => writeEvent(res, event) });
    res.end();
  });
}

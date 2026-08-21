import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createResearchSession,
  createResearchShareLink,
  getActiveResearchShareLinkByTokenHash,
  getResearchSessionForUser,
  listResearchCitations,
  listResearchExports,
  listGoogleWorkspaceExports,
  listResearchFindings,
  listResearchRecommendationOptions,
  listResearchShareLinksForUser,
  listResearchSessionsForUser,
  listResearchSources,
  listResearchSteps,
  revokeResearchShareLinkForUser,
  updateResearchSessionForUser,
} from "../db";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { generateResearchExport } from "../research/export";
import { googleAuthorizationUrl, googleCallbackUrl, generateGoogleWorkspaceExport, isGoogleWorkspaceConnected } from "../integrations/googleWorkspace";
import { GOOGLE_STATE_COOKIE } from "../integrations/googleOAuth";

const querySchema = z.object({ query: z.string().trim().min(8).max(8_000), researchDepth: z.enum(["quick", "standard", "deep"]).default("standard") });
const sessionSchema = z.object({ sessionId: z.string().min(6).max(64) });
const shareTokenSchema = z.object({ token: z.string().min(24).max(128) });

function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function getResearchBundle(sessionId: string) {
  const [steps, sources, findings, recommendationOptions] = await Promise.all([
    listResearchSteps(sessionId),
    listResearchSources(sessionId),
    listResearchFindings(sessionId),
    listResearchRecommendationOptions(sessionId),
  ]);
  const citations = await listResearchCitations(findings.map(finding => finding.id));
  return { steps, sources, findings, citations, recommendationOptions };
}

export const researchRouter = router({
  list: protectedProcedure.query(({ ctx }) => listResearchSessionsForUser(ctx.user.id)),
  create: protectedProcedure.input(querySchema).mutation(({ ctx, input }) => {
    const title = input.query.replace(/\s+/g, " ").slice(0, 96);
    return createResearchSession({ id: nanoid(), userId: ctx.user.id, query: input.query, title, researchDepth: input.researchDepth });
  }),
  get: protectedProcedure.input(sessionSchema).query(async ({ ctx, input }) => {
    const session = await getResearchSessionForUser(input.sessionId, ctx.user.id);
    if (!session) return null;
    const [{ steps, sources, findings, citations, recommendationOptions }, exports, shareLinks] = await Promise.all([
      getResearchBundle(session.id),
      listResearchExports(session.id),
      listResearchShareLinksForUser(session.id, ctx.user.id),
    ]);
    return { session, steps, sources, findings, citations, recommendationOptions, exports, shareLinks };
  }),
  clarify: protectedProcedure.input(z.object({ sessionId: z.string().min(6).max(64), answer: z.string().trim().min(2).max(4_000) })).mutation(async ({ ctx, input }) => {
    const session = await getResearchSessionForUser(input.sessionId, ctx.user.id);
    if (!session) return null;
    const query = `${session.query}\n\nClarification provided by the user: ${input.answer}`;
    return updateResearchSessionForUser(session.id, ctx.user.id, { query, status: "draft", clarifyingQuestion: null, errorMessage: null });
  }),
  export: protectedProcedure.input(z.object({ sessionId: z.string().min(6).max(64), format: z.enum(["markdown", "html"]) })).mutation(({ ctx, input }) =>
    generateResearchExport({ sessionId: input.sessionId, userId: ctx.user.id, format: input.format })
  ),
  googleExportStatus: protectedProcedure.query(async ({ ctx }) => ({ connected: await isGoogleWorkspaceConnected(ctx.user.id) })),
  googleAuthorize: protectedProcedure.mutation(({ ctx }) => {
    const callbackUrl = googleCallbackUrl(ctx.req);
    const authorizationUrl = googleAuthorizationUrl({ userId: ctx.user.id, callbackUrl });
    ctx.res.cookie(GOOGLE_STATE_COOKIE, new URL(authorizationUrl).searchParams.get("state"), { httpOnly: true, sameSite: "lax", secure: callbackUrl.startsWith("https://"), path: "/", maxAge: 10 * 60_000 });
    return { authorizationUrl };
  }),
  googleExport: protectedProcedure.input(z.object({ sessionId: z.string().min(6).max(64), destination: z.enum(["google_doc", "google_sheet", "google_slides"]) })).mutation(({ ctx, input }) =>
    generateGoogleWorkspaceExport({ sessionId: input.sessionId, userId: ctx.user.id, destination: input.destination })
  ),
  googleExports: protectedProcedure.input(sessionSchema).query(({ ctx, input }) => listGoogleWorkspaceExports(input.sessionId, ctx.user.id)),
  broaden: protectedProcedure.input(sessionSchema).mutation(async ({ ctx, input }) => {
    const session = await getResearchSessionForUser(input.sessionId, ctx.user.id);
    if (!session || session.status !== "complete") return null;
    const sources = await listResearchSources(session.id);
    const coveredSourceTitles = sources.slice(0, 12).map(source => source.title).join("; ");
    const query = `${session.query}\n\nBroaden this completed research into a second, complementary pass. Seek additional perspectives, adjacent evidence, and material gaps not addressed by the first brief. Preserve the same decision context, but avoid repeating these already-covered sources where possible: ${coveredSourceTitles || "No sources were retained in the first pass."}`;
    const title = `Broader scope · ${session.title}`.slice(0, 255);
    return createResearchSession({
      id: nanoid(),
      userId: ctx.user.id,
      query,
      title,
      researchDepth: session.researchDepth,
      broadenedFromSessionId: session.id,
    });
  }),
  createShareLink: protectedProcedure.input(sessionSchema).mutation(async ({ ctx, input }) => {
    const session = await getResearchSessionForUser(input.sessionId, ctx.user.id);
    if (!session) return null;
    if (session.status !== "complete") throw new Error("Only completed research briefs can be shared");
    const token = nanoid(36);
    const id = nanoid();
    await createResearchShareLink({ id, sessionId: session.id, ownerId: ctx.user.id, tokenHash: hashShareToken(token) });
    return { id, token, createdAt: new Date() };
  }),
  revokeShareLink: protectedProcedure.input(z.object({ id: z.string().min(6).max(64) })).mutation(async ({ ctx, input }) => {
    await revokeResearchShareLinkForUser(input.id, ctx.user.id);
    return { id: input.id, revoked: true };
  }),
  sharedBrief: publicProcedure.input(shareTokenSchema).query(async ({ input }) => {
    const link = await getActiveResearchShareLinkByTokenHash(hashShareToken(input.token));
    if (!link) return null;
    const session = await getResearchSessionForUser(link.sessionId, link.ownerId);
    if (!session || session.status !== "complete") return null;
    const bundle = await getResearchBundle(session.id);
    return {
      publishedAt: link.createdAt,
      session: {
        id: session.id,
        title: session.title,
        query: session.query,
        researchGoal: session.researchGoal,
        outputFormat: session.outputFormat,
        finalOutput: session.finalOutput,
        completedAt: session.completedAt,
      },
      ...bundle,
    };
  }),
});

import { nanoid } from "nanoid";
import { z } from "zod";
import {
  createResearchSession,
  getResearchSessionForUser,
  listResearchCitations,
  listResearchExports,
  listResearchFindings,
  listResearchSessionsForUser,
  listResearchSources,
  listResearchSteps,
  updateResearchSessionForUser,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { generateResearchExport } from "../research/export";

const querySchema = z.object({ query: z.string().trim().min(8).max(8_000) });
const sessionSchema = z.object({ sessionId: z.string().min(6).max(64) });

export const researchRouter = router({
  list: protectedProcedure.query(({ ctx }) => listResearchSessionsForUser(ctx.user.id)),
  create: protectedProcedure.input(querySchema).mutation(({ ctx, input }) => {
    const title = input.query.replace(/\s+/g, " ").slice(0, 96);
    return createResearchSession({ id: nanoid(), userId: ctx.user.id, query: input.query, title });
  }),
  get: protectedProcedure.input(sessionSchema).query(async ({ ctx, input }) => {
    const session = await getResearchSessionForUser(input.sessionId, ctx.user.id);
    if (!session) return null;
    const [steps, sources, findings, exports] = await Promise.all([
      listResearchSteps(session.id),
      listResearchSources(session.id),
      listResearchFindings(session.id),
      listResearchExports(session.id),
    ]);
    const citations = await listResearchCitations(findings.map(finding => finding.id));
    return { session, steps, sources, findings, citations, exports };
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
});

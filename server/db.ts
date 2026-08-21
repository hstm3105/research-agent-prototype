import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  researchCitations,
  researchExports,
  researchFindings,
  researchRecommendationOptions,
  researchShareLinks,
  researchSessions,
  researchSources,
  researchSteps,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  textFields.forEach(field => {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  });
  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function createResearchSession(input: {
  id: string;
  userId: number;
  query: string;
  title: string;
  researchDepth: "quick" | "standard" | "deep";
  broadenedFromSessionId?: string;
}) {
  const db = await requireDb();
  await db.insert(researchSessions).values({ ...input, status: "draft" });
  return getResearchSessionForUser(input.id, input.userId);
}

export async function getResearchSessionForUser(id: string, userId: number) {
  const db = await requireDb();
  const rows = await db.select().from(researchSessions).where(and(eq(researchSessions.id, id), eq(researchSessions.userId, userId))).limit(1);
  return rows[0] ?? null;
}

export async function listResearchSessionsForUser(userId: number) {
  const db = await requireDb();
  return db.select().from(researchSessions).where(eq(researchSessions.userId, userId)).orderBy(desc(researchSessions.updatedAt));
}

export async function updateResearchSessionForUser(
  id: string,
  userId: number,
  update: Partial<Pick<typeof researchSessions.$inferInsert, "title" | "query" | "researchGoal" | "intent" | "outputFormat" | "status" | "clarifyingQuestion" | "planJson" | "finalOutput" | "errorMessage" | "lifecyclePhase" | "lifecycleProgress" | "lifecycleMessage" | "providerDiagnosticsJson" | "completedAt">>
) {
  const db = await requireDb();
  await db.update(researchSessions).set({ ...update, updatedAt: new Date() }).where(and(eq(researchSessions.id, id), eq(researchSessions.userId, userId)));
  return getResearchSessionForUser(id, userId);
}

export async function replaceResearchSteps(sessionId: string, steps: Array<typeof researchSteps.$inferInsert>) {
  const db = await requireDb();
  await db.delete(researchSteps).where(eq(researchSteps.sessionId, sessionId));
  if (steps.length) await db.insert(researchSteps).values(steps);
}

export async function addResearchStep(step: typeof researchSteps.$inferInsert) {
  const db = await requireDb();
  await db.insert(researchSteps).values(step);
}

export async function updateResearchStepDetails(id: string, update: Pick<typeof researchSteps.$inferInsert, "title" | "description" | "searchQuery">) {
  const db = await requireDb();
  await db.update(researchSteps).set(update).where(eq(researchSteps.id, id));
}

export async function updateResearchStep(id: string, update: Partial<Pick<typeof researchSteps.$inferInsert, "status" | "startedAt" | "completedAt">>) {
  const db = await requireDb();
  await db.update(researchSteps).set(update).where(eq(researchSteps.id, id));
}

export async function listResearchSteps(sessionId: string) {
  const db = await requireDb();
  return db.select().from(researchSteps).where(eq(researchSteps.sessionId, sessionId)).orderBy(researchSteps.ordinal);
}

export async function addResearchSources(sources: Array<typeof researchSources.$inferInsert>) {
  const db = await requireDb();
  if (sources.length) await db.insert(researchSources).values(sources);
}

export async function listResearchSources(sessionId: string) {
  const db = await requireDb();
  return db.select().from(researchSources).where(eq(researchSources.sessionId, sessionId)).orderBy(desc(researchSources.qualityScore), researchSources.retrievedAt);
}

export async function updateResearchSourceQuality(input: Array<{ id: string; qualityScore: number; qualitySignalsJson: string; citationCount: number }>) {
  const db = await requireDb();
  await Promise.all(input.map(source => db.update(researchSources).set({
    qualityScore: source.qualityScore,
    qualitySignalsJson: source.qualitySignalsJson,
    citationCount: source.citationCount,
  }).where(eq(researchSources.id, source.id))));
}

export async function addResearchFindings(findings: Array<typeof researchFindings.$inferInsert>) {
  const db = await requireDb();
  if (findings.length) await db.insert(researchFindings).values(findings);
}

export async function listResearchFindings(sessionId: string) {
  const db = await requireDb();
  return db.select().from(researchFindings).where(eq(researchFindings.sessionId, sessionId)).orderBy(researchFindings.ordinal);
}

export async function addResearchCitations(citations: Array<typeof researchCitations.$inferInsert>) {
  const db = await requireDb();
  if (citations.length) await db.insert(researchCitations).values(citations);
}

export async function listResearchCitations(findingIds: string[]) {
  const db = await requireDb();
  if (!findingIds.length) return [];
  return db.select().from(researchCitations).where(inArray(researchCitations.findingId, findingIds));
}

export async function replaceResearchRecommendationOptions(sessionId: string, options: Array<typeof researchRecommendationOptions.$inferInsert>) {
  const db = await requireDb();
  await db.delete(researchRecommendationOptions).where(eq(researchRecommendationOptions.sessionId, sessionId));
  if (options.length) await db.insert(researchRecommendationOptions).values(options);
}

export async function listResearchRecommendationOptions(sessionId: string) {
  const db = await requireDb();
  return db.select().from(researchRecommendationOptions).where(eq(researchRecommendationOptions.sessionId, sessionId)).orderBy(researchRecommendationOptions.rank);
}

export async function createResearchExport(input: typeof researchExports.$inferInsert) {
  const db = await requireDb();
  await db.insert(researchExports).values(input);
}

export async function listResearchExports(sessionId: string) {
  const db = await requireDb();
  return db.select().from(researchExports).where(eq(researchExports.sessionId, sessionId)).orderBy(desc(researchExports.createdAt));
}

export async function createResearchShareLink(input: typeof researchShareLinks.$inferInsert) {
  const db = await requireDb();
  await db.insert(researchShareLinks).values(input);
}

export async function listResearchShareLinksForUser(sessionId: string, ownerId: number) {
  const db = await requireDb();
  return db.select().from(researchShareLinks).where(and(eq(researchShareLinks.sessionId, sessionId), eq(researchShareLinks.ownerId, ownerId))).orderBy(desc(researchShareLinks.createdAt));
}

export async function revokeResearchShareLinkForUser(id: string, ownerId: number) {
  const db = await requireDb();
  await db.update(researchShareLinks).set({ revokedAt: new Date() }).where(and(eq(researchShareLinks.id, id), eq(researchShareLinks.ownerId, ownerId)));
}

export async function getActiveResearchShareLinkByTokenHash(tokenHash: string) {
  const db = await requireDb();
  const rows = await db.select().from(researchShareLinks).where(and(eq(researchShareLinks.tokenHash, tokenHash), isNull(researchShareLinks.revokedAt))).limit(1);
  return rows[0] ?? null;
}

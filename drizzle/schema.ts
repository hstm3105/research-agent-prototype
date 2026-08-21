import { index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /** Surrogate primary key. Auto-incremented numeric value managed by the database. */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const researchSessions = mysqlTable("researchSessions", {
  id: varchar("id", { length: 48 }).primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  query: text("query").notNull(),
  researchGoal: text("researchGoal"),
  intent: text("intent"),
  researchDepth: mysqlEnum("researchDepth", ["quick", "standard", "deep"]).default("standard").notNull(),
  outputFormat: mysqlEnum("outputFormat", ["report", "summary", "comparison", "timeline", "qa"]).default("report").notNull(),
  status: mysqlEnum("status", ["draft", "awaiting_clarification", "planning", "researching", "complete", "failed"]).default("draft").notNull(),
  clarifyingQuestion: text("clarifyingQuestion"),
  planJson: text("planJson"),
  finalOutput: text("finalOutput"),
  errorMessage: text("errorMessage"),
  lifecyclePhase: varchar("lifecyclePhase", { length: 64 }),
  lifecycleProgress: int("lifecycleProgress"),
  lifecycleMessage: text("lifecycleMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
}, table => [index("researchSessions_user_updated_idx").on(table.userId, table.updatedAt)]);

export const researchSteps = mysqlTable("researchSteps", {
  id: varchar("id", { length: 48 }).primaryKey(),
  sessionId: varchar("sessionId", { length: 48 }).notNull().references(() => researchSessions.id, { onDelete: "cascade" }),
  ordinal: int("ordinal").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  searchQuery: text("searchQuery").notNull(),
  status: mysqlEnum("status", ["pending", "active", "complete", "skipped", "failed"]).default("pending").notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
}, table => [index("researchSteps_session_ordinal_idx").on(table.sessionId, table.ordinal)]);

export const researchSources = mysqlTable("researchSources", {
  id: varchar("id", { length: 48 }).primaryKey(),
  sessionId: varchar("sessionId", { length: 48 }).notNull().references(() => researchSessions.id, { onDelete: "cascade" }),
  stepId: varchar("stepId", { length: 48 }).references(() => researchSteps.id, { onDelete: "set null" }),
  sourceType: mysqlEnum("sourceType", ["web", "model"]).default("web").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  url: text("url").notNull(),
  publisher: varchar("publisher", { length: 255 }),
  excerpt: text("excerpt"),
  retrievedAt: timestamp("retrievedAt").defaultNow().notNull(),
}, table => [index("researchSources_session_idx").on(table.sessionId)]);

export const researchFindings = mysqlTable("researchFindings", {
  id: varchar("id", { length: 48 }).primaryKey(),
  sessionId: varchar("sessionId", { length: 48 }).notNull().references(() => researchSessions.id, { onDelete: "cascade" }),
  stepId: varchar("stepId", { length: 48 }).references(() => researchSteps.id, { onDelete: "set null" }),
  ordinal: int("ordinal").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  claim: text("claim").notNull(),
  evidence: text("evidence").notNull(),
  citationSourceIdsJson: text("citationSourceIdsJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("researchFindings_session_ordinal_idx").on(table.sessionId, table.ordinal)]);

export const researchCitations = mysqlTable("researchCitations", {
  id: varchar("id", { length: 48 }).primaryKey(),
  findingId: varchar("findingId", { length: 48 }).notNull().references(() => researchFindings.id, { onDelete: "cascade" }),
  sourceId: varchar("sourceId", { length: 48 }).notNull().references(() => researchSources.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [
  index("researchCitations_finding_idx").on(table.findingId),
  index("researchCitations_source_idx").on(table.sourceId),
]);

export const researchExports = mysqlTable("researchExports", {
  id: varchar("id", { length: 48 }).primaryKey(),
  sessionId: varchar("sessionId", { length: 48 }).notNull().references(() => researchSessions.id, { onDelete: "cascade" }),
  format: mysqlEnum("format", ["markdown", "html"]).notNull(),
  storageKey: varchar("storageKey", { length: 1024 }).notNull(),
  storageUrl: text("storageUrl").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [index("researchExports_session_idx").on(table.sessionId)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ResearchSession = typeof researchSessions.$inferSelect;
export type ResearchStep = typeof researchSteps.$inferSelect;
export type ResearchSource = typeof researchSources.$inferSelect;
export type ResearchFinding = typeof researchFindings.$inferSelect;
export type ResearchCitation = typeof researchCitations.$inferSelect;
export type ResearchExport = typeof researchExports.$inferSelect;

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ResearchFinding, ResearchRecommendationOption, ResearchSession, ResearchSource } from "../../drizzle/schema";
import { nanoid } from "nanoid";
import { createGoogleWorkspaceExport, getGoogleWorkspaceConnection, getResearchSessionForUser, listResearchFindings, listResearchRecommendationOptions, listResearchSources, upsertGoogleWorkspaceConnection } from "../db";
import { ENV } from "../_core/env";
import { buildDecisionArtifact } from "../research/decisionArtifact";
import type { RecommendationBrief, RecommendationEvidence, RecommendationOption } from "../research/types";
import { buildGoogleDocTemplate, buildGoogleSheetTemplate, buildGoogleSlidesTemplate } from "../research/workspaceTemplates";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
].join(" ");
const CALLBACK_PATH = "/api/integrations/google/callback";
export type GoogleExportDestination = "google_doc" | "google_sheet" | "google_slides";

function baseUrl(req?: { protocol?: string; get?: (key: string) => string | undefined }) {
  const forwardedHost = req?.get?.("x-forwarded-host") || req?.get?.("host");
  const forwardedProtocol = req?.get?.("x-forwarded-proto") || req?.protocol;
  if (forwardedHost) return `${forwardedProtocol === "http" ? "http" : "https"}://${forwardedHost}`;
  return process.env.RESEARCHOS_PUBLIC_URL || "https://researchos-zcvsct26.manus.space";
}

export function googleCallbackUrl(req?: { protocol?: string; get?: (key: string) => string | undefined }) {
  return `${baseUrl(req)}${CALLBACK_PATH}`;
}

function encryptionKey() {
  if (!ENV.cookieSecret) throw new Error("Export token encryption is unavailable");
  return createHash("sha256").update(ENV.cookieSecret).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decrypt(value: string) {
  const [ivValue, tagValue, ciphertext] = value.split(".");
  if (!ivValue || !tagValue || !ciphertext) throw new Error("Stored Google authorization is invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function createGoogleOauthState(userId: number) {
  const payload = Buffer.from(JSON.stringify({ userId, nonce: nanoid(18), expiresAt: Date.now() + 10 * 60_000 })).toString("base64url");
  const signature = createHmac("sha256", encryptionKey()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyGoogleOauthState(state: string): { userId: number } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", encryptionKey()).update(payload).digest("base64url");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId?: number; expiresAt?: number };
    if (!Number.isInteger(parsed.userId) || !parsed.expiresAt || parsed.expiresAt < Date.now()) return null;
    return { userId: Number(parsed.userId) };
  } catch {
    return null;
  }
}

export function googleAuthorizationUrl(input: { userId: number; callbackUrl: string }) {
  if (!ENV.googleOAuthClientId) throw new Error("Google export is not configured");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", ENV.googleOAuthClientId);
  url.searchParams.set("redirect_uri", input.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  url.searchParams.set("state", createGoogleOauthState(input.userId));
  return url.toString();
}

type GoogleTokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };

async function exchangeGoogleToken(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const payload = await response.json() as GoogleTokenResponse;
  if (!response.ok || !payload.access_token) throw new Error("Google authorization exchange failed");
  return payload as Required<Pick<GoogleTokenResponse, "access_token">> & GoogleTokenResponse;
}

export async function storeGoogleAuthorization(input: { userId: number; code: string; callbackUrl: string }) {
  if (!ENV.googleOAuthClientId || !ENV.googleOAuthClientSecret) throw new Error("Google export is not configured");
  const existing = await getGoogleWorkspaceConnection(input.userId);
  const token = await exchangeGoogleToken(new URLSearchParams({
    client_id: ENV.googleOAuthClientId,
    client_secret: ENV.googleOAuthClientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.callbackUrl,
  }));
  const refreshToken = token.refresh_token || (existing ? decrypt(existing.refreshTokenCiphertext) : "");
  if (!refreshToken) throw new Error("Google did not provide renewable export access");
  await upsertGoogleWorkspaceConnection({
    userId: input.userId,
    refreshTokenCiphertext: encrypt(refreshToken),
    accessTokenCiphertext: encrypt(token.access_token),
    accessTokenExpiresAt: token.expires_in ? new Date(Date.now() + Math.max(30, token.expires_in - 30) * 1000) : null,
    scope: token.scope ?? existing?.scope ?? null,
  });
}

export async function isGoogleWorkspaceConnected(userId: number) {
  return Boolean(await getGoogleWorkspaceConnection(userId));
}

async function googleAccessToken(userId: number) {
  const connection = await getGoogleWorkspaceConnection(userId);
  if (!connection) throw new Error("Connect Google Workspace before exporting");
  if (connection.accessTokenCiphertext && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now()) return decrypt(connection.accessTokenCiphertext);
  if (!ENV.googleOAuthClientId || !ENV.googleOAuthClientSecret) throw new Error("Google export is not configured");
  const refreshed = await exchangeGoogleToken(new URLSearchParams({
    client_id: ENV.googleOAuthClientId,
    client_secret: ENV.googleOAuthClientSecret,
    refresh_token: decrypt(connection.refreshTokenCiphertext),
    grant_type: "refresh_token",
  }));
  await upsertGoogleWorkspaceConnection({
    userId,
    refreshTokenCiphertext: connection.refreshTokenCiphertext,
    accessTokenCiphertext: encrypt(refreshed.access_token),
    accessTokenExpiresAt: refreshed.expires_in ? new Date(Date.now() + Math.max(30, refreshed.expires_in - 30) * 1000) : null,
    scope: refreshed.scope ?? connection.scope ?? null,
  });
  return refreshed.access_token;
}

async function googleJson<T>(url: string, accessToken: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Google Workspace export failed with HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function parseStringList(value: string) {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}

function parseEvidence(value: string): RecommendationEvidence[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.flatMap(item => item && typeof item.claim === "string" && Array.isArray(item.sourceUrls) ? [{ claim: item.claim, sourceUrls: item.sourceUrls.filter((url: unknown): url is string => typeof url === "string") }] : []) : [];
  } catch { return []; }
}

function recommendationFromRows(rows: ResearchRecommendationOption[]): RecommendationBrief | null {
  if (!rows.length) return null;
  const options: RecommendationOption[] = rows.map(row => ({ rank: row.rank, name: row.name, summary: row.summary, strengths: parseStringList(row.strengthsJson), caveats: parseStringList(row.caveatsJson), evidence: parseEvidence(row.evidenceJson) }));
  return { criteria: parseStringList(rows[0].criteriaJson), options, selectionAdvice: rows[0].selectionAdvice };
}

async function artifactForSession(sessionId: string, userId: number) {
  const session = await getResearchSessionForUser(sessionId, userId);
  if (!session || session.status !== "complete") throw new Error("Exports are available after research is complete");
  const [sources, findings, recommendationOptions] = await Promise.all([listResearchSources(session.id), listResearchFindings(session.id), listResearchRecommendationOptions(session.id)]);
  return buildDecisionArtifact({
    title: session.title,
    researchGoal: session.researchGoal || session.query,
    outputFormat: session.outputFormat,
    finalSynthesis: session.finalOutput,
    sources,
    findings,
    recommendation: recommendationFromRows(recommendationOptions),
  });
}

async function createGoogleDoc(accessToken: string, title: string, body: string) {
  const document = await googleJson<{ documentId: string }>("https://docs.googleapis.com/v1/documents", accessToken, { title });
  await googleJson(`https://docs.googleapis.com/v1/documents/${document.documentId}:batchUpdate`, accessToken, { requests: [{ insertText: { location: { index: 1 }, text: body } }] });
  return { fileId: document.documentId, fileUrl: `https://docs.google.com/document/d/${document.documentId}/edit` };
}

async function createGoogleSheet(accessToken: string, template: ReturnType<typeof buildGoogleSheetTemplate>) {
  const spreadsheet = await googleJson<{ spreadsheetId: string }>("https://sheets.googleapis.com/v4/spreadsheets", accessToken, { properties: { title: template.title }, sheets: template.sheets.map(sheet => ({ properties: { title: sheet.name } })) });
  await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheet.spreadsheetId}/values:batchUpdate`, accessToken, { valueInputOption: "RAW", data: template.sheets.map(sheet => ({ range: `'${sheet.name}'!A1`, majorDimension: "ROWS", values: sheet.rows })) });
  return { fileId: spreadsheet.spreadsheetId, fileUrl: `https://docs.google.com/spreadsheets/d/${spreadsheet.spreadsheetId}/edit` };
}

async function createGoogleSlides(accessToken: string, template: ReturnType<typeof buildGoogleSlidesTemplate>) {
  const presentation = await googleJson<{ presentationId: string; slides?: Array<{ objectId: string }> }>("https://slides.googleapis.com/v1/presentations", accessToken, { title: template.title });
  const requests: unknown[] = presentation.slides?.[0]?.objectId ? [{ deleteObject: { objectId: presentation.slides[0].objectId } }] : [];
  template.slides.forEach((slide, index) => {
    const pageObjectId = `researchos_slide_${index}`;
    const titleObjectId = `researchos_title_${index}`;
    const bodyObjectId = `researchos_body_${index}`;
    requests.push(
      { createSlide: { objectId: pageObjectId } },
      { createShape: { objectId: titleObjectId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId, size: { width: { magnitude: 8_300_000, unit: "EMU" }, height: { magnitude: 650_000, unit: "EMU" } }, transform: { scaleX: 1, scaleY: 1, translateX: 500_000, translateY: 300_000, unit: "EMU" } } } },
      { insertText: { objectId: titleObjectId, text: slide.title } },
      { createShape: { objectId: bodyObjectId, shapeType: "TEXT_BOX", elementProperties: { pageObjectId, size: { width: { magnitude: 8_300_000, unit: "EMU" }, height: { magnitude: 4_700_000, unit: "EMU" } }, transform: { scaleX: 1, scaleY: 1, translateX: 500_000, translateY: 1_250_000, unit: "EMU" } } } },
      { insertText: { objectId: bodyObjectId, text: [slide.subtitle, ...slide.bullets, slide.sourceUrls.length ? `Sources: ${slide.sourceUrls.join(" · ")}` : ""].filter(Boolean).join("\n\n") } },
    );
  });
  await googleJson(`https://slides.googleapis.com/v1/presentations/${presentation.presentationId}:batchUpdate`, accessToken, { requests });
  return { fileId: presentation.presentationId, fileUrl: `https://docs.google.com/presentation/d/${presentation.presentationId}/edit` };
}

export async function generateGoogleWorkspaceExport(input: { sessionId: string; userId: number; destination: GoogleExportDestination }) {
  const [artifact, accessToken] = await Promise.all([artifactForSession(input.sessionId, input.userId), googleAccessToken(input.userId)]);
  const result = input.destination === "google_doc"
    ? await createGoogleDoc(accessToken, buildGoogleDocTemplate(artifact).title, buildGoogleDocTemplate(artifact).body)
    : input.destination === "google_sheet"
      ? await createGoogleSheet(accessToken, buildGoogleSheetTemplate(artifact))
      : await createGoogleSlides(accessToken, buildGoogleSlidesTemplate(artifact));
  const id = nanoid();
  await createGoogleWorkspaceExport({ id, sessionId: input.sessionId, userId: input.userId, destination: input.destination, fileId: result.fileId, fileUrl: result.fileUrl });
  return { id, destination: input.destination, ...result };
}

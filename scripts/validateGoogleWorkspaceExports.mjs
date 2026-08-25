import { generateGoogleWorkspaceExport } from "../server/integrations/googleWorkspace.ts";

const [sessionId, userIdValue] = process.argv.slice(2);
const userId = Number(userIdValue);

if (!sessionId || !Number.isInteger(userId) || userId < 1) {
  throw new Error("Usage: pnpm tsx scripts/validateGoogleWorkspaceExports.mjs <completed-session-id> <user-id>");
}

const destinations = ["google_doc", "google_sheet", "google_slides"];
const exportsCreated = [];

for (const destination of destinations) {
  const result = await generateGoogleWorkspaceExport({ sessionId, userId, destination });
  exportsCreated.push({ destination: result.destination, fileId: result.fileId, fileUrl: result.fileUrl });
}

console.log(JSON.stringify(exportsCreated, null, 2));

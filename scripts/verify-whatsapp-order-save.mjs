import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

assert.match(app, /function rememberCloudSaveResult\(id, saved\)/, "cloud acknowledgements must be tracked per save");
assert.match(app, /rememberCloudSaveResult\(envelope\.id, false\);\n\s*clearPendingCloudSave\(envelope\.id\);/, "a rejected cloud save must not be treated as successful");
assert.match(app, /rememberCloudSaveResult\(envelope\.id, true\);\n\s*clearPendingCloudSave\(envelope\.id\);/, "a successful cloud save must be acknowledged before its recovery envelope is removed");

const senderStart = app.indexOf("async function sendCurrentOrderToWhatsApp");
const senderEnd = app.indexOf("function renderCart()", senderStart);
const sender = app.slice(senderStart, senderEnd);
assert.match(sender, /deferCloudSave: true/, "the order must be stored locally before WhatsApp without a blocking cloud wait");
assert.match(sender, /window\.open\(url, "_blank", "noopener,noreferrer"\)/, "WhatsApp must open directly without a blank intermediary window");
assert.match(sender, /queueCloudSave\(\{ action: savingDraft \? "draft-whatsapp" : "order-whatsapp" \}\)/, "the cloud save must be queued after WhatsApp opens");
assert.ok(
  sender.indexOf('window.open(url, "_blank", "noopener,noreferrer")') < sender.indexOf('queueCloudSave({ action: savingDraft ? "draft-whatsapp" : "order-whatsapp" })'),
  "the cloud save must be queued after opening WhatsApp",
);
assert.doesNotMatch(sender, /confirmCloudSaveBeforeExternalAction|window\.location\.assign|about:blank/, "WhatsApp must not wait or navigate through a blank page");
assert.match(app, /if \(!options\.deferCloudSave\) \{\n\s*queueCloudSave\(/, "normal saves must keep their immediate cloud backup behavior");

console.log("WhatsApp fast-send and background-backup checks passed.");

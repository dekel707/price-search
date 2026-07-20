import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

assert.match(app, /function rememberCloudSaveResult\(id, saved\)/, "cloud acknowledgements must be tracked per save");
assert.match(app, /async function confirmCloudSaveBeforeExternalAction/, "external sends must wait for a cloud acknowledgement");
assert.match(app, /rememberCloudSaveResult\(envelope\.id, false\);\n\s*clearPendingCloudSave\(envelope\.id\);/, "a rejected cloud save must not be treated as successful");
assert.match(app, /rememberCloudSaveResult\(envelope\.id, true\);\n\s*clearPendingCloudSave\(envelope\.id\);/, "a successful cloud save must be acknowledged before its recovery envelope is removed");

const senderStart = app.indexOf("async function sendCurrentOrderToWhatsApp");
const senderEnd = app.indexOf("function renderCart()", senderStart);
const sender = app.slice(senderStart, senderEnd);
assert.ok(sender.includes("const savedInCloud = await confirmCloudSaveBeforeExternalAction(saveId);"), "WhatsApp must wait for the order save");
assert.ok(sender.indexOf("const savedInCloud = await confirmCloudSaveBeforeExternalAction(saveId);") < sender.indexOf("whatsappWindow.location.replace(url)"), "WhatsApp navigation must occur only after the save wait");
assert.match(sender, /לא נשלחה הודעה בלי הזמנה שמורה/, "a failed save must explicitly keep WhatsApp closed");
assert.match(sender, /window\.open\("about:blank", "_blank"\)/, "the mobile-safe popup must be opened only as a temporary blank window");

console.log("WhatsApp order-save confirmation checks passed.");

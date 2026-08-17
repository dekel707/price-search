import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const endpoint = await readFile(new URL("../api/order-checkpoint.js", import.meta.url), "utf8");

const senderStart = app.indexOf("async function sendCurrentOrderToWhatsApp");
const senderEnd = app.indexOf("function renderCart()", senderStart);
const sender = app.slice(senderStart, senderEnd);

assert.ok(senderStart >= 0 && senderEnd > senderStart, "WhatsApp sender must exist");
assert.ok(
  sender.indexOf("queueCloudSave({ action: cloudAction") < sender.indexOf('window.open(url, "_blank", "noopener,noreferrer")'),
  "the local recovery envelope must be durable before WhatsApp opens",
);
assert.ok(
  sender.indexOf("checkpointOrderBeforeExternalNavigation(savedOrder, recoveryEnvelopeId)") < sender.indexOf('window.open(url, "_blank", "noopener,noreferrer")'),
  "the small server checkpoint must start before WhatsApp opens",
);
assert.match(app, /keepalive: true/, "mobile backgrounding must not cancel the small checkpoint request");
assert.match(app, /CLOUD_FOCUS_REFRESH_MIN_INTERVAL_MS = 5_000/, "returning to the main app must refresh partner orders promptly without polling");
assert.match(endpoint, /MAX_SAVE_ATTEMPTS = 4/, "concurrent saves must be retried with a strict bound");
assert.match(endpoint, /liveOrders\.some\([\s\S]*order\.id/, "the checkpoint must be idempotent by order id");
assert.match(endpoint, /mergeRecentMissingOrders/, "the checkpoint must reuse reservation and last-price recovery logic");
assert.match(endpoint, /savePartnerMainState/, "the checkpoint must use conditional cloud writes and rolling backups");

console.log("Durable order checkpoint checks passed.");

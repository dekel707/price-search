import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { replaceExistingOrderFromCheckpoint } from "../api/_order-conflict-recovery.js";

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
  sender.indexOf("checkpointOrderBeforeExternalNavigation(savedOrder, recoveryEnvelopeId, previousOrder)") < sender.indexOf('window.open(url, "_blank", "noopener,noreferrer")'),
  "the small server checkpoint must start before WhatsApp opens",
);
assert.match(app, /keepalive: true/, "mobile backgrounding must not cancel the small checkpoint request");
assert.match(app, /CLOUD_FOCUS_REFRESH_MIN_INTERVAL_MS = 5_000/, "returning to the main app must refresh partner orders promptly without polling");
assert.match(endpoint, /MAX_SAVE_ATTEMPTS = 4/, "concurrent saves must be retried with a strict bound");
assert.match(endpoint, /liveOrders\.find\([\s\S]*order\.id/, "the checkpoint must be idempotent by order id");
assert.match(endpoint, /mergeRecentMissingOrders/, "the checkpoint must reuse reservation and last-price recovery logic");
assert.match(endpoint, /savePartnerMainState/, "the checkpoint must use conditional cloud writes and rolling backups");
assert.match(endpoint, /replaceExistingOrderFromCheckpoint/, "existing orders must be updated instead of treated as already saved");
assert.match(sender, /previousOrder/, "the client must send the exact version that was edited");

const previousOrder = {
  id: "order-edit-test",
  createdAt: "2026-08-23T10:00:00.000Z",
  updatedAt: "",
  customerId: "customer-1",
  customerName: "לקוח בדיקה",
  orderType: "delivery",
  items: [{ skuKey: "SKU-1", sku: "SKU-1", quantity: 2, unitPrice: 100, lineTotal: 200, fromReservation: true, priceSource: "reservation" }],
  total: 0,
};
const nextOrder = {
  ...structuredClone(previousOrder),
  updatedAt: "2026-08-23T11:00:00.000Z",
  items: [{ skuKey: "SKU-1", sku: "SKU-1", quantity: 1, unitPrice: 120, lineTotal: 120, fromReservation: false, priceSource: "custom" }],
  total: 120,
};
const state = {
  orders: [structuredClone(previousOrder)],
  customers: [{ id: "customer-1", name: "לקוח בדיקה" }],
  reservations: [{ id: "res-1", customerId: "customer-1", customerName: "לקוח בדיקה", skuKey: "SKU-1", sku: "SKU-1", quantity: 3 }],
  lastPrices: {},
};
const replacement = replaceExistingOrderFromCheckpoint(state, previousOrder, nextOrder, new Date("2026-08-23T11:01:00.000Z"));
assert.equal(replacement.updated, true, "a matching previous version must be replaced");
assert.equal(replacement.state.orders[0].total, 120, "the edited total must be saved");
assert.equal(replacement.state.reservations[0].quantity, 5, "the original reservation deduction must be restored");
assert.equal(replacement.state.lastPrices["SKU-1"].price, 120, "last prices must reflect the edited paid line");

const conflicting = replaceExistingOrderFromCheckpoint(
  { ...state, orders: [{ ...previousOrder, total: 999 }] },
  previousOrder,
  nextOrder,
  new Date("2026-08-23T11:01:00.000Z"),
);
assert.equal(conflicting.conflict, true, "a newer live version must not be overwritten");

console.log("Durable order checkpoint checks passed.");

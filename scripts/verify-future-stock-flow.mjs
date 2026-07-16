import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("index.html");
const app = read("src/app.js");
const styles = read("src/styles.css");
const stateApi = read("api/state.js");
const database = read("api/_database.js");

// The future date must never be selectable from the cart. It belongs only to
// the discontinued-product workflow.
assert(!html.includes('id="saveAsFutureStock"'), "The future-stock checkbox must not exist in the cart.");
assert(!html.includes('id="futureStockDate"'), "The future-stock date input must not exist in the cart.");
assert(app.includes("function isFutureStockEligibleProduct(product)"));
assert(app.includes("isDiscontinuedCategory(getAnnotation(product).category)"));
assert(app.includes("function requestFutureStockOrder(product, options = {})"));
assert(app.includes("openArrivalDialog(product, { futureStockOrder: true })"));
assert(app.includes("if (arrivalDate) return createFutureStockOrder(request, arrivalDate);"));
assert(app.includes("function createFutureStockOrder(request, futureStockDate)"));
assert(app.includes("futureStockOrder: true"));
assert(app.includes('queueCloudSave({ action: "future-stock-create" })'));
assert(app.includes("setActiveTab(\"future-stock-orders\")"));

// A selected existing customer can choose the exact-model reservation during
// future-stock creation. It is recorded as a reservation line but deducted
// only when the future order is explicitly saved as an active order.
assert(app.includes("function canOfferFutureStockReservation(product)"));
assert(app.includes("canOfferFutureStockReservation(product)"));
assert(app.includes("fromReservation: Boolean(options.fromReservation)"));
assert(app.includes("const reservation = request.fromReservation ? getCustomerReservation(customer, product.skuKey) : null;"));
assert(app.includes("const reservedQuantity = Math.min(quantity, Math.max(0, reservation?.quantity || 0));"));
assert(app.includes("fromReservation: true"));
assert(app.includes("מהשריון בעת שמירת ההזמנה"));

// The combined button must save the future order first, then open WhatsApp
// using the resulting active order and its calculated delivery destination.
assert(app.includes("data-send-and-commit-future-stock"));
assert(app.includes("function sendFutureStockToWhatsApp(draftId)"));
assert(app.includes("commitFutureStockOrder(draftId, {"));
assert(app.includes("הועברה ללשונית המתאימה ונפתחה לשליחה בוואטסאפ"));

// The future-stock panel uses the same order-card layout, with its own dark
// glass palette rather than the old bright-blue draft treatment.
assert(html.includes('class="orders-panel future-stock-orders-panel"'));
assert(styles.includes(".future-stock-orders-panel"));
assert(styles.includes(".orders-panel-icon.future-stock"));
assert(styles.includes(".future-stock-actions .future-stock-send-commit"));

// A cloud outage must not permit creation of an order that only exists in a
// browser tab, and failed syncing has an automatic recovery path.
assert(app.includes("function requireCloudReadyForMutation(action)"));
assert(app.includes("function scheduleCloudRetry()"));
assert(app.includes("function requestCloudRecovery()"));
assert(app.includes('if (cloudSyncState === "offline") return "ממתין לשמירה בענן";'));
assert(app.includes('futureStockRequest && !requireCloudReadyForMutation("ליצור הזמנת מלאי עתידי")'));
assert(!app.includes("sharedStateResult.seededReservations"), "Loading cloud state must not auto-save migration changes.");
assert(app.includes("clearPendingCloudSave(envelope.id);"));
assert(app.includes("await hydrateCloudState();"));

// Each successful API state change stores a before and after restore point in
// the configured cloud storage. The database path does the same atomically.
assert(stateApi.includes("reason: `before-${action}`"));
assert(stateApi.includes("reason: `after-${action}`"));
assert(database.includes("`before-${action}`"));
assert(database.includes("`after-${action}`"));

console.log("Future-stock and cloud-backup safety checks passed.");

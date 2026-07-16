import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("index.html");
const app = read("src/app.js");
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

// A cloud outage must not permit creation of an order that only exists in a
// browser tab, and failed syncing has an automatic recovery path.
assert(app.includes("function requireCloudReadyForMutation(action)"));
assert(app.includes("function scheduleCloudRetry()"));
assert(app.includes("function requestCloudRecovery()"));
assert(app.includes('if (cloudSyncState === "offline") return "ממתין לשמירה בענן";'));
assert(app.includes('futureStockRequest && !requireCloudReadyForMutation("ליצור הזמנת מלאי עתידי")'));

// Each successful API state change stores a before and after restore point in
// the configured cloud storage. The database path does the same atomically.
assert(stateApi.includes("reason: `before-${action}`"));
assert(stateApi.includes("reason: `after-${action}`"));
assert(database.includes("`before-${action}`"));
assert(database.includes("`after-${action}`"));

console.log("Future-stock and cloud-backup safety checks passed.");

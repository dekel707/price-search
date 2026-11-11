import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, css] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "src/app.js"), "utf8"),
  readFile(path.join(root, "src/styles.css"), "utf8"),
]);

assert.match(html, /id="selfPickup" type="checkbox"/u, "Self-pickup must be an unchecked opt-in control.");
assert.doesNotMatch(html, /id="selfPickup"[^>]*checked/u, "Regular delivery must remain the default.");
assert.match(app, /fulfillmentType:\s*getCurrentFulfillmentType\(\)/u, "Saved orders must retain fulfillment mode.");
assert.match(app, /fulfillmentType:\s*normalizeFulfillmentType\(order\.fulfillmentType\)/u, "Cloud-loaded orders must normalize fulfillment mode.");
assert.match(app, /return value === "pickup" \? "pickup" : "delivery";/u, "Missing and legacy values must default to delivery.");
assert.match(app, /אופן אספקה: איסוף עצמי מהמחסן/u, "WhatsApp and order details must clearly mention self-pickup.");
assert.match(app, /orderSelfPickup = isSelfPickupOrder\(order\);/u, "Editing an order must restore its fulfillment mode.");
assert.match(css, /\.order-fulfillment-toggle input:checked \+ span/u, "The pickup control must have a clear selected state.");

console.log("Self-pickup default, persistence, editing, order-card and WhatsApp checks passed.");

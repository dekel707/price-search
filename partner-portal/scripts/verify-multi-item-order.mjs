import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

const sourcePath = new URL("../api/portal.js", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const sourceWithoutImports = source.replace(/^import .*;\n/gm, "");
const sharedModule = sourceWithoutImports.slice(0, sourceWithoutImports.indexOf("export default async function handler"));
const { buildSafePartnerOrderItems, createOrderDedupeKey } = new Function("crypto", `${sharedModule}\nreturn { buildSafePartnerOrderItems, createOrderDedupeKey };`)(crypto);

const customerId = "customer-multi-item";
const products = Array.from({ length: 10 }, (_, index) => ({
  model: `TEST-MODEL-${index + 1}`,
  skuKey: `TEST-MODEL-${index + 1}`,
  name: `מוצר בדיקה ${index + 1}`,
  price: 100 + index,
}));
const live = {
  products,
  customers: [{ id: customerId, name: "לקוח בדיקה" }],
  reservations: [{ customerId, skuKey: "TEST-MODEL-1", quantity: 3 }],
};
const submittedItems = products.map((product, index) => ({
  model: product.model,
  skuKey: product.skuKey,
  name: product.name,
  quantity: index === 0 ? 5 : 1,
  unitPrice: product.price,
  listPrice: product.price,
  fromReservation: index === 0,
}));

const safeItems = buildSafePartnerOrderItems(live, customerId, submittedItems);
assert.equal(safeItems.length, 10, "a ten-product order must retain every line");
assert.deepEqual(safeItems.map((item) => item.model), products.map((product) => product.model), "product order and model mapping must stay intact");
assert.equal(safeItems[0].quantity, 5, "the selected quantity must be retained");
assert.equal(safeItems[0].reservationQuantity, 3, "reservation use must be clamped to the available balance");
assert.equal(safeItems.slice(1).every((item) => item.reservationQuantity === 0), true, "cash lines must stay cash lines");
assert.equal(typeof createOrderDedupeKey(customerId, safeItems), "string", "the whole ten-line order must receive a stable duplicate key");

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
assert.match(app, /const customer = activeCustomer \|\| displayedCustomer;/, "cart submit must recover an exact customer selected on mobile");
assert.match(app, /customerSelect"\)\.addEventListener\("input"/, "the mobile customer selection must be committed as soon as it is exact");

console.log("Partner portal ten-item order checks passed.");

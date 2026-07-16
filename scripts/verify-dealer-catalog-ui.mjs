import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fallback = JSON.parse(fs.readFileSync(path.join(root, "catalog/public/catalog-fallback.json"), "utf8"));
const page = fs.readFileSync(path.join(root, "catalog/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "catalog/src/main.js"), "utf8");

assert(Array.isArray(fallback.products) && fallback.products.length >= 120, "The public fallback must contain the full product catalog.");
assert(page.includes('id="categoryFilters"'), "The catalog must expose category filters.");
assert(page.includes('id="attributeField"'), "The catalog must expose the numeric specification filter.");
assert(app.includes("METRIC_DEFINITIONS"), "The catalog must define its available numeric filters.");
assert(app.includes("renderCategoryFilters"), "The catalog must render product categories.");
assert(app.includes("matchesNumericFilter"), "The catalog must filter numeric specification ranges.");
assert(app.includes("getProductHighlights"), "The catalog must display the strongest technical highlights on each product.");
assert(app.includes('activeCategory = activeCategory === selectedCategory ? "" : selectedCategory'), "A selected category must toggle off when pressed again.");
assert(app.includes('activeColor = activeColor === selectedColor ? "" : selectedColor'), "A selected quick color filter must toggle off when pressed again.");

const refrigerator = fallback.products.find((product) => product.model === "FJ-NF820DX");
assert(refrigerator, "Expected reference refrigerator in dealer catalog.");
assert.equal(refrigerator.category, "מקרר");
assert.equal(refrigerator.technical?.dimensionsCm?.widthCm, 92);
assert.equal(refrigerator.technical?.dimensionsCm?.heightCm, 191);
assert.equal(refrigerator.technical?.capacities?.totalLiters, 600);
assert(refrigerator.technical?.barcodes?.includes("7290114724692"), "Expected barcode to be searchable in the public technical catalog.");

const forbidden = new Set(["price", "stockQuantity", "customers", "orders", "reservations", "collections"]);
function assertPublicOnly(value, pathLabel = "catalog") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPublicOnly(item, `${pathLabel}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    assert(!forbidden.has(key), `Private field ${key} leaked at ${pathLabel}.`);
    assertPublicOnly(item, `${pathLabel}.${key}`);
  });
}

assertPublicOnly(fallback);
console.log(`Dealer catalog UI checks passed for ${fallback.products.length} public products.`);

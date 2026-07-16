import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fallback = JSON.parse(fs.readFileSync(path.join(root, "catalog/public/catalog-fallback.json"), "utf8"));
const page = fs.readFileSync(path.join(root, "catalog/index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "catalog/src/main.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "catalog/src/styles.css"), "utf8");

assert(Array.isArray(fallback.products) && fallback.products.length >= 120, "The public fallback must contain the full product catalog.");
assert(page.includes('id="categoryFilters"'), "The catalog must expose category filters.");
assert(page.includes('id="simpleFilters"'), "The catalog must expose the simple dealer-facing filter panel.");
assert(!page.includes('id="attributeField"'), "The technical numeric filter must not remain in the dealer catalog.");
assert(!page.includes('id="attributeMin"'), "The dealer catalog must not expose a minimum field.");
assert(!page.includes('id="attributeMax"'), "The dealer catalog must not expose a maximum field.");
assert(app.includes("renderCategoryFilters"), "The catalog must render product categories.");
assert(app.includes("getSimpleFilterGroups"), "The catalog must render simple filter groups.");
assert(app.includes("VOLUME_RANGES"), "The catalog must provide simple volume ranges.");
assert(app.includes("FEATURE_FILTERS"), "The catalog must provide prominent feature filters.");
assert(app.includes("getProductHighlights"), "The catalog must display the strongest technical highlights on each product.");
assert(app.includes("CATEGORY_TABS"), "The catalog must expose the dealer-friendly top category tabs.");
assert(app.includes('key: "top-freezer"'), "The catalog must include a top-freezer category tab.");
assert(app.includes('key: "bottom-freezer"'), "The catalog must include a bottom-freezer category tab.");
assert(app.includes("getCategoryQuickFilterGroups"), "The catalog must provide category-specific quick filters.");
assert(app.includes('"washKg", "קיבולת כביסה"'), "Washing machines must expose quick capacity choices.");
assert(app.includes('"zero-line", "↔ קו אפס"'), "The catalog must display the zero-line refrigerator feature.");
assert(app.includes('"refrigeratorFeature", "מאפיינים חשובים"'), "Refrigerators must expose a quick zero-line filter.");
assert(app.includes("details.open = Boolean(activeValue);"), "All filter groups must be closed by default on a fresh page load.");
assert(styles.includes("overflow-y: auto;"), "The desktop filter sidebar must support independent scrolling.");
assert(styles.includes("overscroll-behavior: contain;"), "The filter sidebar must contain wheel scrolling instead of passing it to the product list.");
assert(app.includes("stripBarcodes"), "Barcodes must be removed before dealer catalog rendering.");
assert(!app.includes('rows.push(["ברקוד"'), "The dealer catalog must not render barcode rows.");
assert(!app.includes('add("◎", `דירוג ${technical.performance.energyRating}`)'), "Energy ratings must not be shown as prominent product icons.");
assert(app.includes('activeCategory = activeCategory === selectedCategory ? "" : selectedCategory'), "A selected category must toggle off when pressed again.");
assert(app.includes('activeFacets[group] = activeFacets[group] === value ? "" : value'), "A selected simple filter must toggle off when pressed again.");

const refrigerator = fallback.products.find((product) => product.model === "FJ-NF820DX");
assert(refrigerator, "Expected reference refrigerator in dealer catalog.");
assert.equal(refrigerator.category, "מקרר");
assert.equal(refrigerator.technical?.dimensionsCm?.widthCm, 92);
assert.equal(refrigerator.technical?.dimensionsCm?.heightCm, 191);
assert.equal(refrigerator.technical?.capacities?.totalLiters, 600);
assert(fallback.products.filter((product) => /קו\s*אפס/.test((product.technical?.facts || []).join(" "))).length >= 3, "Expected zero-line refrigerator data in the public catalog.");

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

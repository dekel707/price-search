import { access, readFile } from "node:fs/promises";

const [productsFile, attributesFile] = await Promise.all([
  readFile(new URL("../public/products.json", import.meta.url), "utf8"),
  readFile(new URL("../data/catalog-attributes.json", import.meta.url), "utf8"),
]);
const [appSource, catalogApiSource] = await Promise.all([
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../api/catalog-specifications.js", import.meta.url), "utf8"),
]);
const products = JSON.parse(productsFile).products;
const catalog = JSON.parse(attributesFile);

const skuKey = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(catalog.schemaVersion === 1, "גרסת מאגר המפרטים אינה תקינה");
assert(appSource.includes('CATALOG_ATTRIBUTES_ENDPOINT = "/api/catalog-specifications"'), "החיפוש אינו מחובר למאגר המפרטים המוגן");
assert(appSource.includes("catalogAttributesBySku[getModelKey(sku)]"), "מפת המפרטים אינה משתמשת במפתח הדגם התקין");
assert(catalogApiSource.includes("isAuthorized(request)"), "נקודת הגישה למפרטים אינה מוגנת");
await access(new URL("../public/catalog-attributes.json", import.meta.url)).then(
  () => { throw new Error("מאגר המפרטים לא אמור להיות חשוף כקובץ ציבורי"); },
  () => undefined,
);
assert(catalog.items && typeof catalog.items === "object", "חסרים פריטי מפרט");
assert(Object.keys(catalog.items).length === products.length, "מספר פריטי המפרט אינו תואם למחירון");

for (const product of products) {
  const item = catalog.items[skuKey(product.sku)];
  assert(item, `חסר מפרט עבור ${product.sku}`);
  assert(item.identity?.model === product.sku, `הדגם במפרט אינו תואם ל-${product.sku}`);
  assert(typeof item.searchText === "string" && item.searchText.length >= product.sku.length, `חסר טקסט חיפוש עבור ${product.sku}`);
  assert(Array.isArray(item.sourceFacts) && item.sourceFacts.length, `חסרים נתוני מקור עבור ${product.sku}`);
  assert(!("price" in item) && !("stockQuantity" in item), `מפרט ${product.sku} מכיל נתון מסחרי שאסור לפרסם`);
}

const byMatch = Object.values(catalog.items).reduce((result, item) => {
  const match = item.source?.match || "unknown";
  result[match] = (result[match] || 0) + 1;
  return result;
}, {});
assert(byMatch.exact_model === 111, `ציפינו ל-111 התאמות ישירות, נמצאו ${byMatch.exact_model || 0}`);
assert(byMatch.catalog_variant === 3, `ציפינו ל-3 התאמות וריאנט, נמצאו ${byMatch.catalog_variant || 0}`);
assert(byMatch.description_only === 13, `ציפינו ל-13 דגמים ללא התאמה ישירה, נמצאו ${byMatch.description_only || 0}`);

const fridge = catalog.items.FJNF820DX;
assert(fridge.dimensionsCm?.widthCm === 92 && fridge.dimensionsCm?.heightCm === 191 && fridge.dimensionsCm?.depthCm === 70, "מידות FJ-NF820DX אינן תקינות");
assert(fridge.capacities?.totalLiters === 600 && fridge.capacities?.freezerLiters === 171, "נפח FJ-NF820DX אינו תקין");
const microwave = catalog.items.FJMW25LB;
assert(microwave.performance?.powerW === 900 && microwave.capacities?.totalLiters === 25, "מפרט FJ-MW25LB אינו תקין");
const tv = catalog.items.FJ50UILQ950;
assert(tv.performance?.screenSizeInches === 50 && tv.displayDimensionsMm?.withoutStand?.widthMm === 1112, "מפרט FJ-50UILQ950 אינו תקין");
const dishwasher = catalog.items.FJDWB8817;
assert(dishwasher.capacities?.placeSettings === 14 && dishwasher.performance?.noiseDb === 44, "מפרט FJ-DWB8817 אינו תקין");

console.log(`תקין: ${products.length} מפרטים | ישיר: ${byMatch.exact_model} | וריאנט: ${byMatch.catalog_variant} | מחירון בלבד: ${byMatch.description_only}`);

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
assert(byMatch.exact_model === 125, `ציפינו ל-125 התאמות ישירות, נמצאו ${byMatch.exact_model || 0}`);
assert(byMatch.catalog_variant === 3, `ציפינו ל-3 התאמות וריאנט, נמצאו ${byMatch.catalog_variant || 0}`);
assert(byMatch.description_only === 13, `ציפינו ל-13 דגמים ללא התאמה ישירה, נמצאו ${byMatch.description_only || 0}`);

const fridge = catalog.items.FJNF820DX;
assert(fridge.dimensionsCm?.widthCm === 92 && fridge.dimensionsCm?.heightCm === 191 && fridge.dimensionsCm?.depthCm === 70, "מידות FJ-NF820DX אינן תקינות");
assert(fridge.capacities?.totalLiters === 600 && fridge.capacities?.freezerLiters === 171, "נפח FJ-NF820DX אינו תקין");
const microwave = catalog.items.FJMW25LB;
assert(microwave.performance?.powerW === 900 && microwave.capacities?.totalLiters === 25, "מפרט FJ-MW25LB אינו תקין");
const retroMicrowaveBlack = catalog.items.FJMWRT88BK;
assert(retroMicrowaveBlack.capacities?.ovenLiters === 55 && retroMicrowaveBlack.performance?.microwaveOutputW === 900 && retroMicrowaveBlack.performance?.combinedPowerW === 3300, "מפרט FJ-MWRT88BK אינו תקין");
assert(retroMicrowaveBlack.dimensionsCm?.widthCm === 59.5 && retroMicrowaveBlack.dimensionsCm?.heightCm === 45.6 && retroMicrowaveBlack.dimensionsCm?.depthCm === 56.8, "מידות FJ-MWRT88BK אינן תקינות");
assert(retroMicrowaveBlack.barcodes?.includes("7290114726122"), "ברקוד FJ-MWRT88BK אינו תקין");
const retroMicrowaveCream = catalog.items.FJMWRT99W;
assert(retroMicrowaveCream.capacities?.ovenLiters === 55 && retroMicrowaveCream.performance?.microwaveOutputW === 900 && retroMicrowaveCream.performance?.combinedPowerW === 3300, "מפרט FJ-MWRT99W אינו תקין");
assert(retroMicrowaveCream.colors?.includes("שמנת") && retroMicrowaveCream.barcodes?.includes("7290114726139"), "נתוני FJ-MWRT99W אינם תקינים");
const convertibleFreezer = catalog.items.FJDF500L;
assert(convertibleFreezer.capacities?.totalLiters === 508 && convertibleFreezer.performance?.energyRating === "E", "מפרט FJ-DF500L אינו תקין");
assert(convertibleFreezer.dimensionsCm?.widthCm === 153 && convertibleFreezer.dimensionsCm?.heightCm === 86 && convertibleFreezer.dimensionsCm?.depthCm === 74, "מידות FJ-DF500L אינן תקינות");
assert(convertibleFreezer.barcodes?.includes("7290114725996"), "ברקוד FJ-DF500L אינו תקין");
const tv = catalog.items.FJ50UILQ950;
assert(tv.performance?.screenSizeInches === 50 && tv.displayDimensionsMm?.withoutStand?.widthMm === 1112, "מפרט FJ-50UILQ950 אינו תקין");
const newTv = catalog.items.FJ65UILQ950;
assert(newTv.performance?.screenSizeInches === 65 && newTv.performance?.resolutionPixels?.width === 3840, "מפרט FJ-65UILQ950 אינו תקין");
assert(newTv.displayDimensionsMm?.withoutStand?.widthMm === 1446 && newTv.displayDimensionsMm?.withStand?.heightMm === 891.3, "מידות FJ-65UILQ950 אינן תקינות");
assert(newTv.barcodes?.includes("7290114725989"), "ברקוד FJ-65UILQ950 אינו תקין");
const dishwasher = catalog.items.FJDWB8817;
assert(dishwasher.capacities?.placeSettings === 14 && dishwasher.performance?.noiseDb === 44, "מפרט FJ-DWB8817 אינו תקין");
const gasHob = catalog.items.FJGOG575BL;
assert(gasHob.dimensionsCm?.widthCm === 75 && gasHob.dimensionsCm?.depthCm === 51, "מידות FJ-GOG575BL אינן תקינות");
assert(gasHob.barcodes?.includes("7290114724715"), "ברקוד FJ-GOG575BL אינו תקין");
const itechOven = catalog.items.IT60L;
assert(itechOven.dimensionsCm?.widthCm === 59.5 && itechOven.dimensionsCm?.heightCm === 59.5 && itechOven.dimensionsCm?.depthCm === 49.4, "מידות IT-60L אינן תקינות");
assert(itechOven.capacities?.ovenLiters === 60 && itechOven.performance?.programCount === 3 && itechOven.performance?.powerW === 3000, "מפרט IT-60L אינו תקין");
assert(itechOven.barcodes?.includes("7290114725842"), "ברקוד IT-60L אינו תקין");
const newFridge = catalog.items.FJNF570WE;
assert(newFridge.dimensionsCm?.widthCm === 70 && newFridge.dimensionsCm?.heightCm === 178 && newFridge.dimensionsCm?.depthCm === 63, "מידות FJ-NF570WE אינן תקינות");
assert(newFridge.capacities?.totalLiters === 404 && newFridge.capacities?.fridgeLiters === 315 && newFridge.capacities?.freezerLiters === 89, "נפחי FJ-NF570WE אינם תקינים");
assert(newFridge.barcodes?.includes("7290114725811"), "ברקוד FJ-NF570WE אינו תקין");
const creamFridge475 = catalog.items.FJNF555GG;
assert(creamFridge475.capacities?.totalLiters === 475 && creamFridge475.dimensionsCm?.heightCm === 183, "מפרט FJ-NF555GG אינו תקין");
assert(creamFridge475.barcodes?.includes("7290114726061") && creamFridge475.colors?.includes("שמנת"), "נתוני FJ-NF555GG אינם תקינים");
const topFreezerWhite = catalog.items.FJNF637W;
assert(topFreezerWhite.capacities?.totalLiters === 615 && topFreezerWhite.capacities?.fridgeLiters === 469 && topFreezerWhite.capacities?.freezerLiters === 146, "נפחי FJ-NF637W אינם תקינים");
assert(topFreezerWhite.dimensionsCm?.widthCm === 83 && topFreezerWhite.dimensionsCm?.heightCm === 187 && topFreezerWhite.dimensionsCm?.depthCm === 70, "מידות FJ-NF637W אינן תקינות");
assert(topFreezerWhite.barcodes?.includes("7290114725828"), "ברקוד FJ-NF637W אינו תקין");
const topFreezerSteel = catalog.items.FJNF640X;
assert(topFreezerSteel.capacities?.totalLiters === 615 && topFreezerSteel.colors?.includes("נירוסטה"), "מפרט FJ-NF640X אינו תקין");
assert(topFreezerSteel.barcodes?.includes("7290114725835"), "ברקוד FJ-NF640X אינו תקין");
const creamFridge539 = catalog.items.FJNF666GG;
assert(creamFridge539.capacities?.totalLiters === 539 && creamFridge539.dimensionsCm?.heightCm === 190, "מפרט FJ-NF666GG אינו תקין");
assert(creamFridge539.barcodes?.includes("7290114726078") && creamFridge539.colors?.includes("שמנת"), "נתוני FJ-NF666GG אינם תקינים");

console.log(`תקין: ${products.length} מפרטים | ישיר: ${byMatch.exact_model} | וריאנט: ${byMatch.catalog_variant} | מחירון בלבד: ${byMatch.description_only}`);

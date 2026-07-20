import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, stateApi] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../api/state.js", import.meta.url), "utf8"),
]);

assert.match(html, /data-tab="promotions"/, "the promotions tab must be available in the main navigation");
assert.match(html, /data-tab-panel="promotions"/, "the promotions workspace panel must be present");
assert.match(html, /id="promotionBuilder"/, "the promotion builder must have a stable mount point");

assert.match(app, /const PROMOTIONS_KEY = "price-search-promotions-v1"/, "promotions need their own local key");
assert.match(app, /function normalizePromotions\(value\)/, "cloud promotion data must be normalized");
assert.match(app, /function savePromotions\(/, "promotion edits must be saved through cloud sync");
assert.match(app, /promotions,\n\s+settings:/, "promotions must be included in the shared cloud state");
assert.match(app, /promotions = normalizePromotions\(state\.promotions\)/, "promotions must be restored from cloud state");
assert.match(stateApi, /promotions: \[\]/, "the state API must preserve promotions for every save");
assert.match(stateApi, /promotions: Array\.isArray\(state\.promotions\)/, "the state API must accept the promotion collection");
assert.match(stateApi, /const includesPromotions = Object\.prototype\.hasOwnProperty\.call/, "older open tabs must be recognized");
assert.match(stateApi, /if \(!includesPromotions\) payload\.promotions =/, "older tabs must not erase saved promotions");

assert.match(app, /function addPromotionToCart\(promotionId\)/, "a whole bundle must be addable to the cart");
assert.match(app, /priceSource: "promotion"/, "bundle lines must keep their promotion source");
assert.match(app, /promotionName: promotion\.name/, "bundle lines must retain the promotion label");
assert.match(app, /function createPromotionWhatsAppUrl\(promotion\)/, "promotions need a WhatsApp sharing flow");
assert.match(app, /function createPromotionMessage\(promotion\)/, "the WhatsApp copy must be built from the full bundle");
assert.match(app, /סה״כ סט:/, "the promotion message must include the bundle total");
assert.match(app, /createPromotionTextField\("שם המבצע", "name"/, "the builder name must map to the saved name field");
assert.match(app, /function getPromotionBuilderProducts\(selectedSkuKey/, "the builder must support focused product filtering");
assert.match(app, /data-promotion-product-search/, "a product-name/model search control must be available in the builder");

console.log("Promotion workspace safety checks passed.");

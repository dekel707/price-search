import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, stateApi, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../api/state.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
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
assert.match(app, /function renderPromotionProductPicker\(\)/, "the builder must render a clear product picker beneath the search");
assert.match(app, /data-select-promotion-product/, "search results must let the user add a product directly to the promotion");
assert.match(app, /data-change-promotion-item/, "a selected promotion item must remain replaceable without a long native dropdown");
assert.match(app, /promotion-item-marker/, "each selected promotion product must have a visible item marker");
assert.match(app, /productButton\.classList\.toggle\("has-product", Boolean\(item\.skuKey\)\)/, "a selected promotion product must receive a visible selected state");
assert.match(styles, /\.promotion-builder-item::before/, "promotion product boxes need a clear visual boundary");
assert.match(styles, /\.promotion-selected-product\.has-product/, "the selected product state needs a dedicated visual treatment");
assert.match(styles, /\.promotions-panel :is\(input, textarea, select\)\s*\{\s*font-size: 16px;/, "mobile promotion inputs must avoid automatic browser zoom");
assert.match(styles, /\.promotion-product-result span,\s*\.promotion-selected-product small\s*\{[\s\S]*?white-space: normal;/, "product names must be allowed to wrap inside their boxes");

console.log("Promotion workspace safety checks passed.");

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
assert.match(app, /function normalizePromotionType\(value\)/, "promotion type must be normalized for backward compatibility");
assert.match(app, /\["unit", "מחיר לכל מוצר"\]/, "the builder must offer independent per-item pricing");
assert.match(app, /\["bundle", "באנדל · מחיר לחבילה"\]/, "the builder must offer a package price mode");
assert.match(app, /"bundlePrice"/, "bundle promotions need one special package price");
assert.match(app, /function addBundlePromotionToCart\(promotion\)/, "bundle promotions need a dedicated all-or-nothing cart flow");
assert.match(app, /promotionBundleQuantity/, "cart lines must retain the number of packages");
assert.match(app, /promotionBundleItemQuantity/, "cart lines must retain quantities per package");
assert.match(app, /promotionBundleLineTotal/, "bundle totals must be retained exactly per component");
assert.match(app, /function updateBundleCartQuantity\(/, "changing a package count must update every component together");
assert.match(app, /cartBundleQuantity/, "the cart must expose package quantity controls");
assert.match(app, /function getCartLineTotal\(/, "order totals must respect fixed package totals");
assert.match(app, /הבאנדל .* הוסר מהסל/, "removing a bundle component must remove the entire bundle");
assert.match(app, /function createPromotionWhatsAppUrl\(promotion\)/, "promotions need a WhatsApp sharing flow");
assert.match(app, /function createPromotionMessage\(promotion\)/, "the WhatsApp copy must be built from the full bundle");
assert.match(app, /מחיר חבילה/, "the promotion message must include the package total");
assert.match(app, /createPromotionTextField\("שם המבצע", "name"/, "the builder name must map to the saved name field");
assert.match(app, /function getPromotionBuilderProducts\(selectedSkuKey/, "the builder must support focused product filtering");
assert.match(app, /data-promotion-product-search/, "a product-name/model search control must be available in the builder");
assert.match(app, /function renderPromotionProductPicker\(\)/, "the builder must render a clear product picker beneath the search");
assert.match(app, /picker\.id = "promotionProductPicker"/, "the product picker must have a stable isolated refresh target");
assert.match(app, /function refreshPromotionProductPicker\(\)/, "typing must refresh only the picker, not the entire builder");
assert.match(app, /refreshPromotionProductPicker\(\);/, "search input must preserve its own mobile keyboard and focus");
assert.doesNotMatch(
  app.slice(app.indexOf("function handlePromotionBuilderInput"), app.indexOf("function focusPromotionProductSearch")),
  /renderPromotionBuilder\(\);/,
  "search input must not re-render and replace itself while a user types",
);
assert.match(app, /productSearch\.inputMode = "search"/, "the mobile keyboard must stay in search mode");
assert.match(app, /data-select-promotion-product/, "search results must let the user add a product directly to the promotion");
assert.match(app, /data-change-promotion-item/, "a selected promotion item must remain replaceable without a long native dropdown");
assert.match(app, /promotion-item-marker/, "each selected promotion product must have a visible item marker");
assert.match(app, /productButton\.classList\.toggle\("has-product", Boolean\(item\.skuKey\)\)/, "a selected promotion product must receive a visible selected state");
assert.match(styles, /\.promotion-builder-item::before/, "promotion product boxes need a clear visual boundary");
assert.match(styles, /\.promotion-selected-product\.has-product/, "the selected product state needs a dedicated visual treatment");
assert.match(styles, /\.promotions-panel :is\(input, textarea, select\)\s*\{\s*font-size: 16px;/, "mobile promotion inputs must avoid automatic browser zoom");
assert.match(styles, /\.promotions-panel\s*\{[\s\S]*?overflow-x: clip;/, "the promotions workspace must not grow horizontally on mobile");
assert.match(styles, /\.promotion-product-search\s*\{\s*font-size: 16px;[\s\S]*?touch-action: manipulation;/, "the mobile search field must keep a stable touch keyboard");
assert.match(styles, /\.promotion-product-result span,\s*\.promotion-selected-product small\s*\{[\s\S]*?white-space: normal;/, "product names must be allowed to wrap inside their boxes");
assert.match(styles, /\/\* Promotions use the same readable action halo as the open-order cards\./, "promotion controls must retain the open-order action halo");
assert.match(styles, /\.promotions-panel \.promotion-builder-actions \.file-button\s*\{[\s\S]*?linear-gradient/, "the primary save action needs a distinct colored treatment");
assert.match(styles, /\.promotions-panel \.promotion-card-actions \.whatsapp-button\s*\{[\s\S]*?0 0 16px rgba\(43, 215, 116, 0\.31\)/, "the WhatsApp action needs its green halo");
assert.match(styles, /\.promotions-panel \.promotion-card-actions \.danger-button\s*\{[\s\S]*?0 0 16px rgba\(231, 59, 94, 0\.28\)/, "the delete action needs its red halo");
assert.match(styles, /\.bundle-promotion-cart-line\s*\{/, "bundle lines need a clear cart treatment");
assert.match(styles, /\.bundle-promotion-builder-item \.promotion-builder-item-top/, "bundle-builder rows need a compact layout without per-item pricing");

console.log("Promotion workspace safety checks passed.");

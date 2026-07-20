import "./styles.css";

const ORDER_WHATSAPP_PHONE = "972523685265";
const state = { user: null, products: [], customers: [], reservations: [], orders: [], cart: [], syncedAt: "", customerId: "", editingOrderId: "", pendingProduct: null, pendingDeleteId: "", activeTab: "search", openReservationCustomers: new Set() };
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });
let actionToastTimer;
let activeAdvancedCategory = "";
const activeAdvancedFacets = { color: "", energy: "", volume: "", height: "", width: "", depth: "", feature: "" };
const activeAdvancedQuickFilters = {};
let orderSearchRenderTimer;
let portalAdvancedSearchRenderTimer;
const orderSearchTextCache = new WeakMap();
const advancedSearchTextCache = new WeakMap();

const ADVANCED_VOLUME_RANGES = [["up-to-100", "עד 100 ליטר", 0, 100], ["101-to-300", "101–300 ליטר", 101, 300], ["301-to-450", "301–450 ליטר", 301, 450], ["451-to-600", "451–600 ליטר", 451, 600], ["over-600", "מעל 600 ליטר", 601, Infinity]];
const ADVANCED_HEIGHT_RANGES = [["up-to-100", "עד 100 ס״מ", 0, 100], ["101-to-170", "101–170 ס״מ", 101, 170], ["171-to-185", "171–185 ס״מ", 171, 185], ["186-to-200", "186–200 ס״מ", 186, 200], ["over-200", "מעל 200 ס״מ", 201, Infinity]];
const ADVANCED_WIDTH_RANGES = [["up-to-50", "עד 50 ס״מ", 0, 50], ["51-to-60", "51–60 ס״מ", 51, 60], ["61-to-70", "61–70 ס״מ", 61, 70], ["71-to-90", "71–90 ס״מ", 71, 90], ["over-90", "מעל 90 ס״מ", 91, Infinity]];
const ADVANCED_DEPTH_RANGES = [["up-to-50", "עד 50 ס״מ", 0, 50], ["51-to-60", "51–60 ס״מ", 51, 60], ["61-to-70", "61–70 ס״מ", 61, 70], ["over-70", "מעל 70 ס״מ", 71, Infinity]];
const ADVANCED_FEATURES = [["zero-line", "↔ קו אפס", (facts) => /קו\s*(אפס|0)|zero\s*-?\s*line/.test(facts)], ["no-frost", "❄ No Frost", (facts) => /no\s*frost|frost\s*no/.test(facts)], ["inverter", "ϟ מנוע אינוורטר", (facts) => /inverter|אינוורטר/.test(facts)], ["4k", "✦ 4K", (facts) => /\b4k\b|\buhd\b/.test(facts)], ["smart", "◉ Smart TV", (facts) => /smart/.test(facts)], ["wifi", "⌁ Wi‑Fi", (facts) => /wi\s*-?\s*fi|wifi/.test(facts)], ["heat-pump", "♨ Heat Pump", (facts) => /heat\s*pump|משאבת חום/.test(facts)], ["induction", "◎ אינדוקציה", (facts) => /אינדוקציה/.test(facts)]];

function showActionToast(message, tone = "success") {
  const toast = $("#portalActionToast");
  const text = $("#portalActionToastMessage");
  const icon = $("#portalActionToastIcon");
  if (!message || !toast || !text || !icon) return;
  if (actionToastTimer) window.clearTimeout(actionToastTimer);
  text.textContent = message;
  icon.textContent = tone === "error" ? "!" : "✓";
  toast.classList.toggle("error", tone === "error");
  toast.hidden = false;
  toast.classList.remove("visible");
  window.requestAnimationFrame(() => toast.classList.add("visible"));
  actionToastTimer = window.setTimeout(() => {
    toast.classList.remove("visible");
    window.setTimeout(() => { if (!toast.classList.contains("visible")) toast.hidden = true; }, 180);
  }, 3800);
}
async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`/api/portal${path}`, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, signal: controller.signal, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "portal_request_failed");
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("הטעינה מתעכבת. נסה לרענן את הדף.");
    throw error;
  } finally { clearTimeout(timeout); }
}

function setTab(name) {
  if (!document.querySelector(`[data-tab="${name}"]`)) return;
  state.activeTab = name;
  document.querySelectorAll(".tab-button").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.tabPanel === name));
  renderFloatingCart();
  if (name === "advanced-search") renderProducts();
}

function formatPrice(value) { return money.format(Number(value) || 0); }
function modelKey(value) { return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, ""); }
function quantityOptions(selected, max = 50) { return Array.from({ length: max }, (_, index) => index + 1).map((value) => `<option value="${value}" ${value === Number(selected) ? "selected" : ""}>${value}</option>`).join(""); }
function customerLabel(customer) { return `${customer.name}${customer.code ? ` · ${customer.code}` : ""}`; }
function isExactCustomerName(value, customer) { return String(value || "").trim() === customerLabel(customer) || String(value || "").trim() === String(customer.name || "").trim(); }

function findCustomer(value = state.customerId) {
  return state.customers.find((customer) => customer.id === value || isExactCustomerName(value, customer)) || null;
}

function resolveCustomerInput(input) {
  const customer = findCustomer(input.value);
  if (customer) input.value = customerLabel(customer);
  return customer;
}

function cartItemCount() {
  return state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function cartTotal(customer = findCustomer(state.customerId)) {
  return state.cart.reduce((sum, item) => {
    const reservation = customer && item.fromReservation ? reservationFor(customer.id, item.model) : null;
    return sum + Math.max(0, item.quantity - Math.min(item.quantity, Number(reservation?.quantity || 0))) * Number(item.price || 0);
  }, 0);
}

function syncActiveCustomerInputs() {
  const customer = findCustomer(state.customerId);
  const label = customer ? customerLabel(customer) : "";
  ["#customerSelect"].forEach((selector) => {
    const input = $(selector);
    if (input) input.value = label;
  });
}

function selectActiveCustomer(input) {
  const typed = String(input.value || "").trim();
  const selected = findCustomer(typed);
  const active = findCustomer(state.customerId);
  if (!selected) {
    if (!typed && !state.cart.length) {
      state.customerId = "";
      syncActiveCustomerInputs();
      return null;
    }
    input.value = active ? customerLabel(active) : "";
    if (typed) $("#cartMessage").textContent = "בחר לקוח קיים מהרשימה.";
    return active;
  }
  if (active && active.id !== selected.id && state.cart.length) {
    input.value = customerLabel(active);
    $("#cartMessage").textContent = "כדי להחליף לקוח יש לנקות או לשלוח את ההזמנה הנוכחית.";
    return active;
  }
  state.customerId = selected.id;
  syncActiveCustomerInputs();
  return selected;
}

function clearActiveCustomer() {
  state.customerId = "";
  syncActiveCustomerInputs();
}

function renderFloatingCart(total = cartTotal(), count = cartItemCount()) {
  const bubble = $("#portalFloatingCart");
  if (!bubble) return;
  const customer = findCustomer(state.customerId);
  bubble.hidden = !count || state.activeTab === "cart";
  $("#portalFloatingCartCount").textContent = count.toLocaleString("he-IL");
  $("#portalFloatingCartCustomer").textContent = customer ? customer.name : "סל הזמנה";
  $("#portalFloatingCartSummary").textContent = `${count.toLocaleString("he-IL")} פריטים · ${formatPrice(total)}`;
  bubble.setAttribute("aria-label", `פתח סל הזמנה: ${count.toLocaleString("he-IL")} פריטים עבור ${customer?.name || "לקוח"}`);
}

function renderCustomerOptions() {
  const options = state.customers.map((customer) => `<option value="${escapeAttr(customerLabel(customer))}"></option>`).join("");
  $("#customerOptions").innerHTML = options;
  $("#cartCustomerOptions").innerHTML = options;
}

function matchesProductSearch(product, query) {
  if (!query) return true;
  let searchText = orderSearchTextCache.get(product);
  if (!searchText) {
    searchText = `${product.name} ${product.model} ${product.category} ${(product.colors || []).join(" ")} ${(product.technical?.facts || []).join(" ")}`.toLowerCase();
    orderSearchTextCache.set(product, searchText);
  }
  return searchText.includes(query);
}

function cleanFacts(product, max = 3) {
  return (product.technical?.facts || []).filter((fact) => !/[?？]/.test(String(fact))).slice(0, max).map((fact) => `<span class="portal-fact-tag">${escapeHtml(fact)}</span>`).join("");
}

function productDocumentLinks(product) {
  const documents = (product.documents || []).filter((document) => String(document?.url || "").startsWith("http"));
  if (!documents.length) return "";
  return `<div class="product-document-links">${documents.map((document) => `<a class="secondary-button document-link" href="${escapeAttr(document.url)}" target="_blank" rel="noreferrer">${escapeHtml(document.label || document.type || "דף מוצר")}</a>`).join("")}</div>`;
}

function productSpecification(product) {
  const dimensions = product.technical?.dimensionsCm || {};
  const capacities = product.technical?.capacities || {};
  const performance = product.technical?.performance || {};
  const labels = {
    widthCm: "רוחב", heightCm: "גובה", depthCm: "עומק", totalLiters: "נפח כולל", fridgeLiters: "נפח מקרר", freezerLiters: "נפח מקפיא", ovenLiters: "נפח תנור", washKg: "קיבולת כביסה", bottleCount: "בקבוקים", placeSettings: "מערכות כלים", powerW: "הספק", programCount: "תוכניות", noiseDb: "רעש", waterConsumptionLiters: "צריכת מים", spinRpm: "סל״ד", airflowM3h: "ספיקת אוויר", screenSizeInches: "גודל מסך", energyRating: "דירוג אנרגטי",
  };
  const units = { widthCm: "ס״מ", heightCm: "ס״מ", depthCm: "ס״מ", totalLiters: "ל׳", fridgeLiters: "ל׳", freezerLiters: "ל׳", ovenLiters: "ל׳", washKg: "ק״ג", bottleCount: "בקבוקים", placeSettings: "מערכות", powerW: "W", programCount: "תוכניות", noiseDb: "dB", waterConsumptionLiters: "ל׳", spinRpm: "סל״ד", airflowM3h: "מק״ש", screenSizeInches: "אינץ׳" };
  const entries = [dimensions, capacities, performance].flatMap((group) => Object.entries(group || {})).filter(([key, value]) => labels[key] && value !== "" && value !== null && value !== undefined).slice(0, 30);
  const facts = (product.technical?.facts || []).filter((fact) => !/[?？]/.test(String(fact))).slice(3, 20);
  if (!entries.length && !facts.length) return "";
  return `<details class="product-specification"><summary>מפרט מלא</summary><div class="product-spec-grid">${entries.map(([key, value]) => `<span><b>${labels[key]}</b> ${escapeHtml(value)}${units[key] ? ` ${units[key]}` : ""}</span>`).join("")}${facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}</div></details>`;
}

function stockLabel(product) {
  return `<span class="stock-label in-stock">במלאי: ${Number(product.stockQuantity).toLocaleString("he-IL")}</span>`;
}

function renderOrderSearch() {
  const query = $("#orderSearchInput").value.trim().toLowerCase();
  const matches = state.products.filter((product) => matchesProductSearch(product, query));
  const limit = query ? 80 : 24;
  const visible = matches.slice(0, limit);
  $("#orderSearchResults").innerHTML = visible.map((product) => productCard(product, { ordering: true })).join("") || `<p class="muted">לא נמצאו מוצרים במחירון.</p>`;
  $("#orderSearchStatus").textContent = query
    ? `${matches.length.toLocaleString("he-IL")} התאמות${matches.length > visible.length ? ` · מוצגים ${visible.length.toLocaleString("he-IL")} ראשונים` : ""}`
    : `הקלד דגם או שם לחיפוש מהיר · מוצגים ${visible.length.toLocaleString("he-IL")} דגמים ראשונים`;
}

function scheduleOrderSearchRender() {
  window.clearTimeout(orderSearchRenderTimer);
  orderSearchRenderTimer = window.setTimeout(renderOrderSearch, 70);
}

const ADVANCED_CATEGORY_TABS = [
  { key: "refrigerators", label: "מקררים", matches: (product) => advancedIsCategory(product, "מקרר") },
  { key: "top-freezer", label: "מקפיא עליון", matches: (product) => advancedMatchesRefrigeratorStyle(product, "top") },
  { key: "bottom-freezer", label: "מקפיא תחתון", matches: (product) => advancedMatchesRefrigeratorStyle(product, "bottom") },
  { key: "four-door", label: "4 דלתות", matches: (product) => advancedMatchesRefrigeratorStyle(product, "four-door") },
  { key: "integrated-refrigerators", label: "מקררים אינטגרליים", matches: (product) => advancedMatchesRefrigeratorStyle(product, "integrated") },
  { key: "mini-refrigerators", label: "מקררים משרדיים", matches: (product) => advancedMatchesRefrigeratorStyle(product, "mini") },
  { key: "freezers", label: "מקפיאים", matches: (product) => advancedIsCategory(product, "מקפיא") },
  { key: "upright-freezers", label: "מקפיאים עומדים", matches: (product) => advancedMatchesFreezerStyle(product, "upright") },
  { key: "chest-freezers", label: "מקפיאים שוכבים", matches: (product) => advancedMatchesFreezerStyle(product, "chest") },
  { key: "washing-machines", label: "מכונות כביסה", matches: (product) => advancedIsCategory(product, "מכונת כביסה") },
  { key: "dryers", label: "מייבשים", matches: (product) => advancedIsCategory(product, "מייבש כביסה") },
  { key: "dishwashers", label: "מדיחי כלים", matches: (product) => advancedIsCategory(product, "מדיח כלים") },
  { key: "ovens", label: "תנורים", matches: (product) => advancedIsCategory(product, "תנור") },
  { key: "hobs", label: "כיריים", matches: (product) => advancedIsCategory(product, "כיריים") },
  { key: "microwaves", label: "מיקרוגלים", matches: (product) => advancedIsCategory(product, "מיקרוגל") },
  { key: "tvs", label: "טלוויזיות", matches: (product) => advancedIsCategory(product, "טלוויזיה") },
  { key: "hoods", label: "קולטי אדים", matches: (product) => advancedIsCategory(product, "קולט אדים") },
];

function advancedCategoryName(product) { return String(product.category || product.technical?.category || "").trim(); }
function advancedIsCategory(product, category) {
  const current = advancedCategoryName(product);
  const aliases = { "מקרר": ["מקרר", "מקררים"], "מקפיא": ["מקפיא", "מקפיאים"], "מכונת כביסה": ["מכונת כביסה", "מכונות כביסה"], "מייבש כביסה": ["מייבש כביסה", "מייבשים"], "מדיח כלים": ["מדיח כלים", "מדיחי כלים"], "תנור": ["תנור", "תנורים"], "מיקרוגל": ["מיקרוגל", "מיקרוגלים"], "טלוויזיה": ["טלוויזיה", "טלוויזיות"], "קולט אדים": ["קולט אדים", "קולטי אדים"] };
  return (aliases[category] || [category]).includes(current);
}
function advancedFacts(product) { return `${product.name || ""} ${advancedCategoryName(product)} ${(product.technical?.facts || []).join(" ")}`.toLowerCase(); }
function advancedValue(product, group, key) { return product.technical?.[group]?.[key]; }
function advancedNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function advancedMatchesRange(value, range) { const number = advancedNumber(value); return Boolean(range) && number !== null && number >= range.minimum && number <= range.maximum; }
function advancedRange(ranges, value) { const found = ranges.find(([rangeValue]) => rangeValue === value); return found ? { minimum: found[2], maximum: found[3] } : null; }
function advancedFormatNumber(value) { return Number(value).toLocaleString("he-IL"); }

function schedulePortalAdvancedSearchRender() {
  window.clearTimeout(portalAdvancedSearchRenderTimer);
  portalAdvancedSearchRenderTimer = window.setTimeout(() => renderProducts({ refreshFilters: false }), 90);
}

function renderProducts({ refreshFilters = true } = {}) {
  if (refreshFilters) {
    renderAdvancedCategoryFilters();
    renderAdvancedSimpleFilters();
  }
  const query = $("#advancedSearchInput").value.trim().toLowerCase();
  const visible = state.products.filter((product) => advancedMatchesProduct(product, query) && advancedMatchesActiveCategory(product) && advancedMatchesSimpleFilters(product)).slice(0, 80);
  $("#advancedSearchStatus").textContent = visible.length ? `${visible.length.toLocaleString("he-IL")} מוצרים מתאימים` : "לא נמצאו מוצרים";
  $("#productResults").innerHTML = visible.map((product) => productCard(product)).join("") || `<div class="empty-state">לא נמצאו דגמים מתאימים. נסה לשנות את הסינון.</div>`;
}

function advancedMatchesProduct(product, query) {
  if (!query) return true;
  const haystack = getAdvancedSearchText(product);
  return query.split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

function getAdvancedSearchText(product) {
  const cached = advancedSearchTextCache.get(product);
  if (cached) return cached;
  const technical = product.technical || {};
  const values = [technical.dimensionsCm, technical.capacities, technical.performance].flatMap((group) => Object.values(group || {}));
  const value = `${product.name || ""} ${product.model || ""} ${advancedCategoryName(product)} ${(product.colors || []).join(" ")} ${(technical.facts || []).join(" ")} ${values.join(" ")}`.toLowerCase();
  advancedSearchTextCache.set(product, value);
  return value;
}

function getActiveAdvancedCategory() { return ADVANCED_CATEGORY_TABS.find((tab) => tab.key === activeAdvancedCategory) || null; }
function advancedMatchesActiveCategory(product) { const tab = getActiveAdvancedCategory(); return !tab || tab.matches(product); }
function getActiveAdvancedProducts() { return state.products.filter(advancedMatchesActiveCategory); }

function clearAdvancedQuickFilters() { Object.keys(activeAdvancedQuickFilters).forEach((key) => { delete activeAdvancedQuickFilters[key]; }); }
function clearAdvancedFacets() { Object.keys(activeAdvancedFacets).forEach((key) => { activeAdvancedFacets[key] = ""; }); }
function hasActiveAdvancedFilters() { return Object.values(activeAdvancedFacets).some(Boolean) || Object.values(activeAdvancedQuickFilters).some(Boolean); }
function advancedFilterValue(key) { return key.startsWith("quick-") ? (activeAdvancedQuickFilters[key.slice(6)] || "") : (activeAdvancedFacets[key] || ""); }

function renderAdvancedCategoryFilters() {
  const filters = $("#categoryFilters");
  filters.replaceChildren(...ADVANCED_CATEGORY_TABS.map((tab) => ({ tab, count: state.products.filter(tab.matches).length })).filter(({ count }) => count).map(({ tab, count }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `advanced-category-chip ${activeAdvancedCategory === tab.key ? "active" : ""}`;
    button.dataset.category = tab.key;
    button.textContent = `${tab.label} · ${count.toLocaleString("he-IL")}`;
    return button;
  }));
  $("#clearAdvancedCategory").hidden = !activeAdvancedCategory;
}

function renderAdvancedSimpleFilters() {
  const tab = getActiveAdvancedCategory();
  const groups = [...advancedQuickGroups(), ...advancedSimpleGroups()];
  $("#advancedFilterKicker").textContent = tab ? "סינון מהיר לקטגוריה" : "סינון פשוט";
  $("#advancedFilterTitle").textContent = tab ? tab.label : "מצא את הדגם המתאים";
  $("#quickFilters").replaceChildren(...groups.map(createAdvancedFilterGroup));
  $("#clearAdvancedFilters").hidden = !hasActiveAdvancedFilters() && !activeAdvancedCategory;
}

function advancedQuickGroups() {
  if (!activeAdvancedCategory) return [];
  const products = getActiveAdvancedProducts();
  const refrigeratorTabs = new Set(["refrigerators", "top-freezer", "bottom-freezer", "four-door", "integrated-refrigerators", "mini-refrigerators"]);
  const freezerTabs = new Set(["freezers", "upright-freezers", "chest-freezers"]);
  if (refrigeratorTabs.has(activeAdvancedCategory)) {
    const groups = [advancedRangeGroup("volume", "נפח מקרר", products, ADVANCED_VOLUME_RANGES, (product) => advancedValue(product, "capacities", "totalLiters")), advancedOptionGroup("refrigeratorFeature", "מאפיינים חשובים", products, [["zero-line", "קו אפס"]])];
    if (activeAdvancedCategory === "refrigerators") groups.unshift(advancedOptionGroup("fridgeStyle", "סוג מקרר", products, [["top", "מקפיא עליון"], ["bottom", "מקפיא תחתון"], ["four-door", "4 דלתות"], ["integrated", "אינטגרלי"], ["mini", "משרדי / מיני"]]));
    return groups.filter(Boolean);
  }
  if (freezerTabs.has(activeAdvancedCategory)) {
    const groups = [advancedRangeGroup("volume", "נפח מקפיא", products, ADVANCED_VOLUME_RANGES, (product) => advancedValue(product, "capacities", "totalLiters"))];
    if (activeAdvancedCategory === "freezers") groups.unshift(advancedOptionGroup("freezerStyle", "סוג מקפיא", products, [["upright", "מקפיא עומד"], ["chest", "מקפיא שוכב"], ["integrated", "אינטגרלי"]]));
    return groups.filter(Boolean);
  }
  if (activeAdvancedCategory === "washing-machines") return [advancedNumericGroup("washKg", "קיבולת כביסה", products, (product) => advancedValue(product, "capacities", "washKg"), (value) => `${advancedFormatNumber(value)} ק״ג`), advancedNumericGroup("spinRpm", "מהירות סחיטה", products, (product) => advancedValue(product, "performance", "spinRpm"), (value) => `${advancedFormatNumber(value)} סל״ד`)].filter(Boolean);
  if (activeAdvancedCategory === "dryers") return [advancedNumericGroup("washKg", "קיבולת ייבוש", products, (product) => advancedValue(product, "capacities", "washKg"), (value) => `${advancedFormatNumber(value)} ק״ג`)].filter(Boolean);
  if (activeAdvancedCategory === "tvs") return [advancedNumericGroup("screenSize", "גודל מסך", products, (product) => advancedValue(product, "performance", "screenSizeInches"), (value) => `${advancedFormatNumber(value)} אינץ׳`)].filter(Boolean);
  if (activeAdvancedCategory === "dishwashers") return [advancedOptionGroup("dishwasherStyle", "סוג מדיח", products, [["counter", "על השיש"], ["integrated", "אינטגרלי"], ["standard", "רגיל"]]), advancedNumericGroup("placeSettings", "מערכות כלים", products, (product) => advancedValue(product, "capacities", "placeSettings"), (value) => `${advancedFormatNumber(value)} מערכות`)].filter(Boolean);
  if (activeAdvancedCategory === "ovens") return [advancedOptionGroup("ovenStyle", "סוג תנור", products, [["built-in", "בנוי"], ["standing", "עומד / משולב"], ["microwave", "משולב מיקרו"]]), advancedNumericGroup("ovenLiters", "נפח תא אפייה", products, (product) => advancedValue(product, "capacities", "ovenLiters"), (value) => `${advancedFormatNumber(value)} ליטר`)].filter(Boolean);
  if (activeAdvancedCategory === "hobs") return [advancedOptionGroup("hobType", "סוג כיריים", products, [["gas", "גז"], ["induction", "אינדוקציה"]])].filter(Boolean);
  if (activeAdvancedCategory === "microwaves") return [advancedNumericGroup("microwaveLiters", "נפח", products, (product) => advancedValue(product, "capacities", "totalLiters"), (value) => `${advancedFormatNumber(value)} ליטר`)].filter(Boolean);
  if (activeAdvancedCategory === "hoods") return [advancedOptionGroup("hoodWidth", "רוחב", products, [["60", "60 ס״מ"], ["90", "90 ס״מ"]])].filter(Boolean);
  return [];
}

function advancedNumericGroup(key, label, products, getValue, format) {
  const counts = new Map();
  products.forEach((product) => { const value = advancedNumber(getValue(product)); if (value !== null) counts.set(value, (counts.get(value) || 0) + 1); });
  const options = [...counts.entries()].map(([value, count]) => ({ value: String(value), label: format(value), count })).sort((left, right) => Number(left.value) - Number(right.value));
  return options.length ? { key: `quick-${key}`, label, options } : null;
}
function advancedRangeGroup(key, label, products, ranges, getValue) { const options = advancedRangeOptions(ranges, getValue, products); return options.length ? { key: `quick-${key}`, label, options } : null; }
function advancedOptionGroup(key, label, products, definitions) { const options = definitions.map(([value, optionLabel]) => ({ value, label: optionLabel, count: products.filter((product) => advancedMatchesQuickFilter(product, key, value)).length })).filter((option) => option.count); return options.length ? { key: `quick-${key}`, label, options } : null; }

function advancedSimpleGroups() {
  const products = getActiveAdvancedProducts();
  const quickVolume = new Set(["refrigerators", "top-freezer", "bottom-freezer", "four-door", "integrated-refrigerators", "mini-refrigerators", "freezers", "upright-freezers", "chest-freezers", "microwaves"]).has(activeAdvancedCategory);
  const countValues = (values, label = (value) => value) => { const counts = new Map(); values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)); return [...counts.entries()].map(([value, count]) => ({ value, label: label(value), count })); };
  return [
    { key: "color", label: "צבע", options: countValues(products.flatMap((product) => product.colors || [])).sort((a, b) => a.label.localeCompare(b.label, "he")) },
    { key: "energy", label: "דירוג אנרגטי", options: countValues(products.map((product) => advancedValue(product, "performance", "energyRating")), (value) => `דירוג ${value}`).sort((a, b) => a.value.localeCompare(b.value, "en")) },
    { key: "feature", label: "תכונות בולטות", options: ADVANCED_FEATURES.map(([value, label]) => ({ value, label, count: products.filter((product) => advancedMatchesFeature(product, value)).length })).filter((option) => option.count) },
    ...(!quickVolume ? [{ key: "volume", label: "נפח", options: advancedRangeOptions(ADVANCED_VOLUME_RANGES, (product) => advancedValue(product, "capacities", "totalLiters"), products) }] : []),
    { key: "height", label: "גובה", options: advancedRangeOptions(ADVANCED_HEIGHT_RANGES, (product) => advancedValue(product, "dimensionsCm", "heightCm"), products) },
    { key: "width", label: "רוחב", options: advancedRangeOptions(ADVANCED_WIDTH_RANGES, (product) => advancedValue(product, "dimensionsCm", "widthCm"), products) },
    { key: "depth", label: "עומק", options: advancedRangeOptions(ADVANCED_DEPTH_RANGES, (product) => advancedValue(product, "dimensionsCm", "depthCm"), products) },
  ].filter((group) => group.options.length);
}

function advancedRangeOptions(ranges, getValue, products) { return ranges.map(([value, label, minimum, maximum]) => ({ value, label, count: products.filter((product) => advancedMatchesRange(getValue(product), { minimum, maximum })).length })).filter((option) => option.count); }
function createAdvancedFilterGroup(group) {
  const details = document.createElement("details");
  details.className = "portal-simple-filter-group";
  const activeValue = advancedFilterValue(group.key);
  details.open = Boolean(activeValue) || Boolean(activeAdvancedCategory && group.key.startsWith("quick-"));
  const summary = document.createElement("summary");
  summary.textContent = group.label;
  const options = document.createElement("div");
  options.className = "portal-simple-filter-options";
  group.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "portal-simple-filter-option";
    button.dataset.filterGroup = group.key;
    button.dataset.filterValue = option.value;
    button.setAttribute("aria-pressed", String(activeValue === option.value));
    button.textContent = `${option.label} (${option.count})`;
    button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); toggleAdvancedFilter(group.key, option.value); });
    options.append(button);
  });
  details.append(summary, options);
  return details;
}

function toggleAdvancedFilter(group, value) {
  if (group.startsWith("quick-")) { const key = group.slice(6); activeAdvancedQuickFilters[key] = activeAdvancedQuickFilters[key] === value ? "" : value; }
  else if (group in activeAdvancedFacets) activeAdvancedFacets[group] = activeAdvancedFacets[group] === value ? "" : value;
  renderProducts();
}

function advancedMatchesSimpleFilters(product) {
  return (!activeAdvancedFacets.color || (product.colors || []).includes(activeAdvancedFacets.color))
    && (!activeAdvancedFacets.energy || advancedValue(product, "performance", "energyRating") === activeAdvancedFacets.energy)
    && (!activeAdvancedFacets.volume || advancedMatchesRange(advancedValue(product, "capacities", "totalLiters"), advancedRange(ADVANCED_VOLUME_RANGES, activeAdvancedFacets.volume)))
    && (!activeAdvancedFacets.height || advancedMatchesRange(advancedValue(product, "dimensionsCm", "heightCm"), advancedRange(ADVANCED_HEIGHT_RANGES, activeAdvancedFacets.height)))
    && (!activeAdvancedFacets.width || advancedMatchesRange(advancedValue(product, "dimensionsCm", "widthCm"), advancedRange(ADVANCED_WIDTH_RANGES, activeAdvancedFacets.width)))
    && (!activeAdvancedFacets.depth || advancedMatchesRange(advancedValue(product, "dimensionsCm", "depthCm"), advancedRange(ADVANCED_DEPTH_RANGES, activeAdvancedFacets.depth)))
    && (!activeAdvancedFacets.feature || advancedMatchesFeature(product, activeAdvancedFacets.feature))
    && Object.entries(activeAdvancedQuickFilters).every(([key, value]) => !value || advancedMatchesQuickFilter(product, key, value));
}

function advancedMatchesFeature(product, value) { const feature = ADVANCED_FEATURES.find(([key]) => key === value); return Boolean(feature?.[2](advancedFacts(product))); }
function advancedMatchesQuickFilter(product, key, value) {
  if (key === "washKg") return advancedNumber(advancedValue(product, "capacities", "washKg")) === Number(value);
  if (key === "spinRpm") return advancedNumber(advancedValue(product, "performance", "spinRpm")) === Number(value);
  if (key === "screenSize") return advancedNumber(advancedValue(product, "performance", "screenSizeInches")) === Number(value);
  if (key === "placeSettings") return advancedNumber(advancedValue(product, "capacities", "placeSettings")) === Number(value);
  if (key === "ovenLiters") return advancedNumber(advancedValue(product, "capacities", "ovenLiters")) === Number(value);
  if (key === "microwaveLiters") return advancedNumber(advancedValue(product, "capacities", "totalLiters")) === Number(value);
  if (key === "volume") return advancedMatchesRange(advancedValue(product, "capacities", "totalLiters"), advancedRange(ADVANCED_VOLUME_RANGES, value));
  if (key === "refrigeratorFeature") return value === "zero-line" && advancedIsCategory(product, "מקרר") && /קו\s*(אפס|0)|zero\s*-?\s*line/.test(advancedFacts(product));
  if (key === "fridgeStyle") return advancedMatchesRefrigeratorStyle(product, value);
  if (key === "freezerStyle") return advancedMatchesFreezerStyle(product, value);
  if (key === "dishwasherStyle") { const facts = advancedFacts(product); return value === "counter" ? /על השיש/.test(facts) : value === "integrated" ? /אינטגרלי/.test(facts) : !/על השיש|אינטגרלי/.test(facts); }
  if (key === "ovenStyle") { const facts = advancedFacts(product); return value === "built-in" ? /בנוי/.test(facts) && !/משולב מיקרו/.test(facts) : value === "standing" ? /עומד|משולב/.test(facts) && !/משולב מיקרו/.test(facts) : /משולב מיקרו/.test(facts); }
  if (key === "hobType") return value === "gas" ? /גז/.test(advancedFacts(product)) : /אינדוקציה/.test(advancedFacts(product));
  if (key === "hoodWidth") return advancedNumber(advancedValue(product, "dimensionsCm", "widthCm")) === Number(value) || new RegExp(`\\b${value}\\s*סמ`).test(advancedFacts(product));
  return false;
}
function advancedMatchesRefrigeratorStyle(product, style) { if (!advancedIsCategory(product, "מקרר")) return false; const facts = advancedFacts(product); return style === "top" ? /מקפיא עליון/.test(facts) : style === "bottom" ? /מקפיא תחתון|מקפיא תחתחון/.test(facts) : style === "four-door" ? /4 דלתות/.test(facts) : style === "integrated" ? /אינטגרלי/.test(facts) : /משרדי|קוביה|יין|ויטרינה/.test(facts); }
function advancedMatchesFreezerStyle(product, style) { if (!advancedIsCategory(product, "מקפיא")) return false; const facts = advancedFacts(product); return style === "chest" ? /שוכב/.test(facts) : style === "upright" ? !/שוכב/.test(facts) : /אינטגרלי/.test(facts); }

function productCard(product, { ordering = false } = {}) {
  const facts = cleanFacts(product);
  const action = ordering ? `<div class="inline-add-fields"><label class="inline-add-field"><span>כמות</span><select data-quantity-for="${escapeAttr(product.model)}">${quantityOptions(1, 50)}</select></label><button class="add-cart-button" type="button" data-order-add="${escapeAttr(product.model)}">הוסף לסל</button></div>` : `<div class="advanced-readonly-actions"><span class="portal-readonly-badge">מפרט לקריאה בלבד</span></div>`;
  return `<article class="result-row"><div class="result-main"><div class="result-content"><div class="sku">${escapeHtml(product.model || "—")}</div><div class="description">${escapeHtml(product.name || product.model)}</div><div class="annotation-meta"><span class="category-label">${escapeHtml(product.category || "מוצר")}</span>${ordering ? stockLabel(product) : ""}</div>${facts ? `<div class="portal-fact-tags">${facts}</div>` : ""}${!ordering ? `${productSpecification(product)}${productDocumentLinks(product)}` : ""}</div>${ordering ? `<strong class="price">${formatPrice(product.price)}</strong>` : ""}</div><div class="item-tools">${action}</div></article>`;
}

function reservationFor(customerId, model) {
  return state.reservations.find((item) => item.customerId === customerId && modelKey(item.skuKey || item.sku) === modelKey(model) && Number(item.quantity) > 0) || null;
}

function openAddDialog(product, quantity = 1) {
  const customer = findCustomer(state.customerId);
  state.pendingProduct = product;
  $("#cartCustomerTitle").textContent = `הוספת ${product.model} לסל`;
  $("#pendingProductSummary").innerHTML = `<strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.model)} · ${formatPrice(product.price)}</span>`;
  $("#cartProductQuantity").innerHTML = quantityOptions(quantity, 50);
  $("#cartProductPrice").value = Number(product.price || 0);
  $("#cartCustomerInput").value = customer ? customerLabel(customer) : "";
  $("#cartCustomerInput").readOnly = Boolean(customer);
  $("#cartCustomerLockHint").hidden = !customer;
  $("#cartCustomerFeedback").textContent = "";
  // Every new add flow starts with the reservation choice derived from the selected customer.
  // A manual uncheck remains respected while this dialog stays open.
  delete $("#cartProductReservation").dataset.reservationFor;
  updateDialogReservation();
  $("#cartCustomerDialog").hidden = false;
  window.setTimeout(() => (customer ? $("#cartProductQuantity") : $("#cartCustomerInput")).focus(), 0);
}

function closeAddDialog() {
  state.pendingProduct = null;
  $("#cartCustomerInput").readOnly = false;
  $("#cartCustomerLockHint").hidden = true;
  $("#cartCustomerDialog").hidden = true;
}

function updateDialogReservation() {
  const customer = resolveCustomerInput($("#cartCustomerInput"));
  const reservation = customer && state.pendingProduct ? reservationFor(customer.id, state.pendingProduct.model) : null;
  const wrap = $("#cartProductReservationWrap");
  const toggle = $("#cartProductReservation");
  wrap.hidden = !reservation;
  if (reservation) {
    const reservationFor = `${customer.id}:${modelKey(state.pendingProduct.model)}`;
    if (toggle.dataset.reservationFor !== reservationFor) toggle.checked = true;
    toggle.dataset.reservationFor = reservationFor;
    wrap.lastChild.textContent = ` משיכה משריון הלקוח · זמינות ${Number(reservation.quantity).toLocaleString("he-IL")} יח׳`;
  } else {
    toggle.checked = false;
    delete toggle.dataset.reservationFor;
  }
}

function addPendingToCart() {
  const product = state.pendingProduct;
  const customer = resolveCustomerInput($("#cartCustomerInput"));
  const activeCustomer = findCustomer(state.customerId);
  const quantity = Number($("#cartProductQuantity").value) || 1;
  const price = Number($("#cartProductPrice").value);
  if (!product || !customer) { $("#cartCustomerFeedback").textContent = "בחר לקוח מהרשימה."; return; }
  if (activeCustomer && activeCustomer.id !== customer.id) { $("#cartCustomerFeedback").textContent = "הסל כבר משויך ללקוח אחר. נקה או שלח את ההזמנה לפני החלפת לקוח."; return; }
  if (!Number.isFinite(price) || price < 0) { $("#cartCustomerFeedback").textContent = "הזן מחיר תקין."; return; }
  state.customerId = customer.id;
  syncActiveCustomerInputs();
  const fromReservation = $("#cartProductReservation").checked && Boolean(reservationFor(customer.id, product.model));
  const existing = state.cart.find((item) => modelKey(item.model) === modelKey(product.model) && Number(item.price) === price && item.fromReservation === fromReservation);
  if (existing) existing.quantity += quantity;
  else state.cart.push({ model: product.model, skuKey: product.skuKey || product.model, name: product.name || product.model, price, unitPrice: price, quantity, fromReservation });
  closeAddDialog();
  renderCart();
  $("#orderSearchStatus").textContent = `${product.model} נוסף לסל עבור ${customer.name}. אפשר להמשיך להוסיף מוצרים או לפתוח את בועת הסל.`;
  showActionToast(`${product.model} נוסף לסל.`);
}

function renderCart() {
  const customer = findCustomer(state.customerId);
  const count = cartItemCount();
  $("#cartCount").textContent = count ? count.toLocaleString("he-IL") : "";
  $("#cartCount").hidden = !count;
  $("#searchCartCount").textContent = count ? `${count} פריטים` : "ריק";
  $("#cartItems").innerHTML = state.cart.map((item, index) => {
    const reservation = customer && item.fromReservation ? reservationFor(customer.id, item.model) : null;
    const plannedReservation = reservation ? Math.min(item.quantity, Number(reservation.quantity)) : 0;
    const paidQuantity = item.quantity - plannedReservation;
    return `<article class="cart-line ${item.fromReservation ? "reservation-cart-line" : ""}"><div class="cart-line-header"><div class="cart-line-title"><strong>${escapeHtml(item.model)}</strong><span>${escapeHtml(item.name)}</span><small>${formatPrice(item.price)} ליח׳ · ${plannedReservation ? `${plannedReservation} יח׳ מהשריון${paidQuantity ? ` · ${paidQuantity} יח׳ במחיר` : ""}` : "מהמחירון"}</small></div>${customer && reservationFor(customer.id, item.model) ? `<label class="reservation-choice"><input type="checkbox" data-cart-reservation="${index}" ${item.fromReservation ? "checked" : ""} /> משיכה משריון · זמינות ${Number(reservationFor(customer.id, item.model).quantity).toLocaleString("he-IL")} יח׳</label>` : ""}</div><div class="portal-cart-actions"><label class="field-wrap"><span>כמות</span><select data-cart-quantity="${index}">${quantityOptions(item.quantity)}</select></label><label class="field-wrap"><span>מחיר</span><input type="number" min="0" step="0.01" inputmode="decimal" value="${escapeAttr(item.price)}" data-cart-price="${index}" /></label><button class="danger-button" type="button" data-remove="${index}">מחק</button></div></article>`;
  }).join("") || `<div class="empty-state">הסל ריק. עבור ללשונית חיפוש כדי להוסיף מוצרים.</div>`;
  const total = cartTotal(customer);
  $("#cartTotal").textContent = `סה״כ לתשלום לפי מחירון: ${formatPrice(total)}`;
  $("#cartTitle").textContent = state.editingOrderId ? "עריכת הזמנה" : "הזמנה חדשה";
  $("#submitOrder").textContent = state.editingOrderId ? "שמור שינויים בהזמנה" : "שלח הזמנה";
  $("#cancelEditOrder").hidden = !state.editingOrderId;
  syncActiveCustomerInputs();
  renderFloatingCart(total, count);
}

function renderData() {
  renderCustomerOptions();
  if (state.customerId && !findCustomer(state.customerId)) state.customerId = "";
  syncActiveCustomerInputs();
  $("#customerList").innerHTML = state.customers.map((item) => `<article class="customer-card portal-customer-card"><div><strong>${escapeHtml(item.name)}</strong><p>${escapeHtml(item.phone || "ללא טלפון")}</p></div><span class="portal-readonly-badge">קריאה בלבד</span></article>`).join("") || `<div class="empty-state">אין לקוחות.</div>`;
  const reservationGroups = state.customers.map((customer) => ({ customer, items: state.reservations.filter((item) => item.customerId === customer.id && Number(item.quantity) > 0) })).filter((group) => group.items.length);
  $("#reservationList").innerHTML = reservationGroups.map(({ customer, items }) => `<details class="reservation-customer-card" data-reservation-customer="${escapeAttr(customer.id)}" ${state.openReservationCustomers.has(customer.id) ? "open" : ""}><summary class="reservation-customer-header"><div><strong>${escapeHtml(customer.name)}</strong><span>${items.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString("he-IL")} יח׳ בשריון</span></div><b>הצג פירוט</b></summary><div class="portal-reservation-body">${customer.phone ? `<button class="whatsapp-button reservation-export-button" type="button" data-send-reservations="${escapeAttr(customer.id)}">שלח שריון בוואטסאפ</button>` : ""}${items.map((item) => `<div class="reservation-row"><div class="reservation-product"><strong>${escapeHtml(item.sku || item.skuKey)}</strong><span>${escapeHtml(item.description || "")}</span></div><b>${Number(item.quantity).toLocaleString("he-IL")} יח׳</b></div>`).join("")}</div></details>`).join("") || `<div class="empty-state">אין שריונים פעילים.</div>`;
  $("#orderList").innerHTML = state.orders.map(orderCard).join("") || `<p class="muted">עדיין לא יצרת הזמנות.</p>`;
}

function orderCard(order) {
  const labels = { processing: "מסנכרן", sent_to_main: "נכנסה למערכת", sync_failed: "מנסה שוב לשלוח" };
  const items = (order.items || []).map((item) => `${item.name} ×${item.quantity}${Number(item.reservationQuantity || 0) ? ` · שריון ${item.reservationQuantity}` : ""}`).join(" · ");
  return `<article class="order-card"><div class="order-body"><strong>${escapeHtml(order.customer_name || "לקוח")}</strong><span>${escapeHtml(items)}</span><small>${escapeHtml(labels[order.status] || order.status)} · ${new Date(order.created_at).toLocaleString("he-IL")}</small></div><div class="order-card-actions"><button class="secondary-button" type="button" data-show-order="${escapeAttr(order.id)}">הצג הזמנה</button><button class="whatsapp-button" type="button" data-send-order="${escapeAttr(order.id)}">WhatsApp</button><button class="secondary-button" type="button" data-edit-order="${escapeAttr(order.id)}">ערוך</button><button class="danger-button" type="button" data-delete-order="${escapeAttr(order.id)}">מחק</button></div></article>`;
}

function showOrder(order) {
  const items = (order.items || []).map((item) => `${item.name} · ${item.quantity} יח׳ · ${formatPrice(item.unitPrice)}${item.fromReservation ? " · שריון" : ""}`).join("\n");
  window.alert(`${order.customer_name}\n\n${items}`);
}

function editOrder(order) {
  const customer = findCustomer(order.mainCustomerId);
  if (!customer) { $("#cartMessage").textContent = "הלקוח כבר אינו זמין במערכת הראשית ולכן אי אפשר לערוך את ההזמנה."; setTab("cart"); return; }
  state.editingOrderId = order.id;
  state.customerId = customer.id;
  state.cart = (order.items || []).map((item) => ({ model: item.model, skuKey: item.skuKey || item.model, name: item.name || item.model, quantity: Number(item.quantity) || 1, price: Number(item.unitPrice ?? item.listPrice) || 0, unitPrice: Number(item.unitPrice ?? item.listPrice) || 0, fromReservation: Boolean(item.fromReservation) }));
  $("#cartMessage").textContent = "ערוך את הכמויות והמחירים ולאחר מכן שמור. השינוי יעודכן גם בהזמנה המקבילה אצל דקל.";
  renderCart(); setTab("cart");
}

function openDeleteDialog(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  state.pendingDeleteId = orderId;
  $("#deleteOrderSummary").textContent = `מחיקת ההזמנה של ${order.customer_name || "הלקוח"}.`;
  $("#deleteOrderDialog").hidden = false;
}

function closeDeleteDialog() { state.pendingDeleteId = ""; $("#deleteOrderDialog").hidden = true; }

async function deleteOrder(orderId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  try {
    await api("?action=delete-order", { method: "POST", body: JSON.stringify({ orderId }) });
    if (state.editingOrderId === orderId) cancelEdit();
    await refresh();
    $("#orderActionMessage").textContent = "ההזמנה נמחקה.";
    showActionToast("ההזמנה נמחקה.");
  } catch (error) { $("#orderActionMessage").textContent = `המחיקה לא הושלמה: ${error.message}`; showActionToast("המחיקה לא הושלמה.", "error"); }
}

function clearCart(message = "") {
  state.editingOrderId = "";
  state.cart = [];
  clearActiveCustomer();
  $("#cartMessage").textContent = message;
  renderCart();
  if (message) showActionToast(message);
}

function cancelEdit() { clearCart("עריכת ההזמנה בוטלה והסל נוקה."); }

async function refresh() {
  document.querySelectorAll(".reservation-customer-card[open]").forEach((item) => state.openReservationCustomers.add(item.dataset.reservationCustomer));
  const [live, orders] = await Promise.all([api("?resource=live"), api("?resource=orders")]);
  Object.assign(state, { products: live.products || [], customers: live.customers || [], reservations: live.reservations || [], orders: orders.items || [], syncedAt: live.updatedAt || "" });
  renderOrderSearch();
  renderData(); renderCart();
  const updated = state.syncedAt ? new Date(state.syncedAt).toLocaleString("he-IL") : "כעת";
  $("#portalSubtitle").textContent = "איתן · מחירון, מלאי, לקוחות ושריונים מסונכרנים לקריאה בלבד";
  $("#portalMetadata").textContent = `${live.syncMode === "cached" ? "גיבוי עדכני" : "עודכן"} ${updated} · ${state.products.length.toLocaleString("he-IL")} דגמים במלאי`;
  $("#orderSearchStatus").textContent = live.syncMode === "cached"
    ? "הגשר למערכת הראשית אינו זמין כרגע. מוצג הסנכרון האחרון שנשמר בפורטל."
    : "מוצגים רק דגמים בעלי מלאי חיובי. מלאי, מחירון, לקוחות ושריונים מתעדכנים מהמערכת הראשית.";
  setTab(state.activeTab);
}

function sendReservationsToWhatsApp(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  const entries = state.reservations.filter((item) => item.customerId === customerId && Number(item.quantity) > 0);
  const phone = String(customer?.phone || "").replace(/\D/g, "").replace(/^0/, "972");
  if (!customer || !phone || !entries.length) return;
  const text = [`שריון עבור ${customer.name}`, "", ...entries.map((item) => `${item.sku || item.skuKey} · ${item.description || ""} — ${Number(item.quantity).toLocaleString("he-IL")} יח׳`)].filter(Boolean).join("\n");
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  showActionToast("הודעת השריון נפתחה ב‑WhatsApp.");
}

function whatsappText({ customerName, items, createdAt }) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const lines = normalizedItems.flatMap(formatPartnerWhatsAppLines);
  const total = normalizedItems.reduce((sum, item) => {
    const quantity = Math.max(0, Number(item.quantity || 0));
    const reservationQuantity = partnerReservationQuantity(item);
    return sum + Math.max(0, quantity - reservationQuantity) * Number(item.price ?? item.unitPrice ?? 0);
  }, 0);
  return [
    customerName ? `הזמנה - ${customerName}` : "הזמנה",
    "",
    ...lines,
    "",
    `סה״כ הזמנה: ${formatPlainPartnerPrice(total)} ש״ח`,
  ].join("\n");
}

function formatPlainPartnerPrice(value) { return Number(value || 0).toLocaleString("he-IL", { maximumFractionDigits: 2 }); }
function formatPartnerQuantity(quantity) { return Number(quantity) === 1 ? "יחידה" : "יחידות"; }
function partnerReservationQuantity(item) {
  const quantity = Math.max(0, Number(item?.quantity || 0));
  const requested = item?.reservationQuantity;
  const quantityFromReservation = requested === undefined || requested === null
    ? (item?.fromReservation ? quantity : 0)
    : Number(requested);
  const numericReservation = Number(quantityFromReservation);
  return Math.min(quantity, Math.max(0, Number.isFinite(numericReservation) ? numericReservation : 0));
}
function formatPartnerWhatsAppLines(item) {
  const quantity = Math.max(0, Number(item?.quantity || 0));
  const reservationQuantity = partnerReservationQuantity(item);
  const paidQuantity = Math.max(0, quantity - reservationQuantity);
  const model = String(item?.model || item?.skuKey || "מוצר").trim();
  const line = (count, suffix) => `${count.toLocaleString("he-IL")} ${formatPartnerQuantity(count)} (${model})${suffix}`;
  return [
    ...(reservationQuantity ? [line(reservationQuantity, " · משריון")] : []),
    ...(paidQuantity ? [line(paidQuantity, ` לפי ${formatPlainPartnerPrice(item?.price ?? item?.unitPrice)} ש״ח`)] : []),
  ];
}

function openOrderWhatsApp(order, targetWindow = null) {
  if (!order) return false;
  const url = `https://wa.me/${ORDER_WHATSAPP_PHONE}?text=${encodeURIComponent(whatsappText({ customerName: order.customer_name, items: order.items, createdAt: order.created_at }))}`;
  if (targetWindow && !targetWindow.closed) targetWindow.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
  showActionToast("ההודעה נפתחה ב‑WhatsApp.");
  return true;
}

function currentCartCustomer() {
  const customer = findCustomer(state.customerId);
  if (!customer || !state.cart.length) { $("#cartMessage").textContent = "יש לבחור לקוח ולהוסיף מוצרים לפני שמירת ההזמנה."; return null; }
  const displayedCustomer = resolveCustomerInput($("#customerSelect"));
  if (!displayedCustomer || displayedCustomer.id !== customer.id) {
    syncActiveCustomerInputs();
    $("#cartMessage").textContent = "הסל משויך ללקוח הפעיל. נקה את ההזמנה כדי לבחור לקוח אחר.";
    return null;
  }
  return customer;
}

async function persistCurrentCartOrder({ openWhatsApp = false } = {}) {
  const customer = currentCartCustomer();
  if (!customer) return null;
  const submit = $("#submitOrder");
  const whatsapp = $("#sendCartWhatsApp");
  const draftWindow = openWhatsApp ? window.open("about:blank", "_blank") : null;
  submit.disabled = true;
  whatsapp.disabled = true;
  const editing = state.editingOrderId;
  try {
    const result = await api(`?action=${editing ? "update-order" : "create-order"}`, { method: "POST", body: JSON.stringify({ ...(editing ? { orderId: editing } : {}), customerId: customer.id, items: state.cart.map((item) => ({ ...item, unitPrice: item.price })) }) });
    const savedOrder = result.order;
    const plannedReservationUnits = Number(result.plannedReservationUnits || 0);
    state.cart = [];
    state.editingOrderId = "";
    clearActiveCustomer();
    await refresh();
    if (openWhatsApp) openOrderWhatsApp(savedOrder, draftWindow);
    $("#cartMessage").textContent = `${editing ? "השינויים נשמרו" : "ההזמנה נשמרה"}${plannedReservationUnits ? `. ${plannedReservationUnits.toLocaleString("he-IL")} יח׳ מסומנות לשריון לפי היתרה העדכנית.` : ""}${openWhatsApp ? " ונפתחה לשליחה ב‑WhatsApp." : ""}`;
    showActionToast(openWhatsApp ? "ההזמנה נשמרה ונפתחה ב‑WhatsApp." : (editing ? "השינויים בהזמנה נשמרו." : "ההזמנה נשמרה."));
    return savedOrder;
  } catch (error) {
    if (draftWindow && !draftWindow.closed) draftWindow.close();
    $("#cartMessage").textContent = `ההזמנה לא נשמרה: ${error.message}`;
    showActionToast("ההזמנה לא נשמרה.", "error");
    return null;
  } finally {
    submit.disabled = false;
    whatsapp.disabled = false;
  }
}

async function sendCartToWhatsApp() {
  await persistCurrentCartOrder({ openWhatsApp: true });
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#loginMessage").textContent = "מתחבר…";
  const submit = $("#loginForm button"); submit.disabled = true;
  try { const result = await api("?action=login", { method: "POST", body: JSON.stringify({ pin: $("#pin").value }) }); state.user = result.user; $("#loginView").hidden = true; $("#portalView").hidden = false; await refresh(); startRefreshTimer(); }
  catch (error) { $("#loginMessage").textContent = `לא ניתן להיכנס: ${error.message}`; }
  finally { submit.disabled = false; }
});

$("#logoutButton").addEventListener("click", async () => {
  await api("?action=logout", { method: "POST" }); location.reload();
});
document.querySelectorAll(".tab-button").forEach((tab) => tab.addEventListener("click", (event) => { event.preventDefault(); setTab(tab.dataset.tab); }));
$("#orderSearchInput").addEventListener("input", scheduleOrderSearchRender);
$("#advancedSearchInput").addEventListener("input", schedulePortalAdvancedSearchRender);
$("#openCartFromSearch").addEventListener("click", () => setTab("cart"));
$("#backToOrderSearch").addEventListener("click", () => setTab("search"));
$("#portalFloatingCart").addEventListener("click", () => setTab("cart"));
$("#customerSelect").addEventListener("change", () => { selectActiveCustomer($("#customerSelect")); renderCart(); renderOrderSearch(); });
$("#clearCart").addEventListener("click", () => clearCart("ההזמנה נוקתה והלקוח שוחרר."));
$("#categoryFilters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  const selected = button.dataset.category || "";
  activeAdvancedCategory = activeAdvancedCategory === selected ? "" : selected;
  clearAdvancedFacets();
  clearAdvancedQuickFilters();
  renderProducts();
});
$("#clearAdvancedCategory").addEventListener("click", () => {
  activeAdvancedCategory = "";
  clearAdvancedFacets();
  clearAdvancedQuickFilters();
  renderProducts();
});
$("#clearAdvancedFilters").addEventListener("click", () => {
  activeAdvancedCategory = "";
  clearAdvancedFacets();
  clearAdvancedQuickFilters();
  renderProducts();
});
$("#orderSearchResults").addEventListener("click", (event) => { const button = event.target.closest("[data-order-add]"); if (!button) return; const product = state.products.find((item) => item.model === button.dataset.orderAdd); const picker = button.closest(".item-tools")?.querySelector("[data-quantity-for]"); if (product) openAddDialog(product, picker?.value || 1); });
$("#cartCustomerForm").addEventListener("submit", (event) => { event.preventDefault(); addPendingToCart(); });
$("#closeCartCustomerDialog").addEventListener("click", closeAddDialog);
$("#cartCustomerDialog").addEventListener("click", (event) => { if (event.target === $("#cartCustomerDialog")) closeAddDialog(); });
$("#cartCustomerInput").addEventListener("input", updateDialogReservation);
$("#cartCustomerInput").addEventListener("change", updateDialogReservation);
$("#cartItems").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  const [removed] = state.cart.splice(Number(button.dataset.remove), 1);
  renderCart();
  if (removed) showActionToast(`${removed.model} הוסר מהסל.`);
});
$("#cartItems").addEventListener("change", (event) => {
  const quantity = event.target.closest("[data-cart-quantity]");
  if (quantity) {
    const item = state.cart[Number(quantity.dataset.cartQuantity)];
    if (item) item.quantity = Number(quantity.value) || 1;
    renderCart();
    return;
  }
  const price = event.target.closest("[data-cart-price]");
  if (price) {
    const item = state.cart[Number(price.dataset.cartPrice)];
    if (item && Number.isFinite(Number(price.value)) && Number(price.value) >= 0) item.price = Number(price.value);
    renderCart();
    return;
  }
  const toggle = event.target.closest("[data-cart-reservation]");
  if (toggle) {
    const item = state.cart[Number(toggle.dataset.cartReservation)];
    if (item) item.fromReservation = toggle.checked;
    renderCart();
    showActionToast(toggle.checked ? "המוצר יסומן למשיכה משריון." : "המוצר יחויב לפי מחירון.");
  }
});
$("#reservationList").addEventListener("click", (event) => { const button = event.target.closest("[data-send-reservations]"); if (button) sendReservationsToWhatsApp(button.dataset.sendReservations); });
$("#reservationList").addEventListener("toggle", (event) => { const details = event.target.closest?.("[data-reservation-customer]"); if (!details) return; if (details.open) state.openReservationCustomers.add(details.dataset.reservationCustomer); else state.openReservationCustomers.delete(details.dataset.reservationCustomer); }, true);
$("#orderList").addEventListener("click", (event) => { const show = event.target.closest("[data-show-order]"); const send = event.target.closest("[data-send-order]"); const edit = event.target.closest("[data-edit-order]"); const remove = event.target.closest("[data-delete-order]"); if (show) showOrder(state.orders.find((item) => item.id === show.dataset.showOrder)); if (send) openOrderWhatsApp(state.orders.find((item) => item.id === send.dataset.sendOrder)); if (edit) editOrder(state.orders.find((item) => item.id === edit.dataset.editOrder)); if (remove) openDeleteDialog(remove.dataset.deleteOrder); });
$("#closeDeleteOrderDialog").addEventListener("click", closeDeleteDialog);
$("#cancelDeleteOrder").addEventListener("click", closeDeleteDialog);
$("#confirmDeleteOrder").addEventListener("click", async () => { const orderId = state.pendingDeleteId; closeDeleteDialog(); if (orderId) await deleteOrder(orderId); });
$("#deleteOrderDialog").addEventListener("click", (event) => { if (event.target === $("#deleteOrderDialog")) closeDeleteDialog(); });
$("#cancelEditOrder").addEventListener("click", cancelEdit);
$("#sendCartWhatsApp").addEventListener("click", sendCartToWhatsApp);
$("#submitOrder").addEventListener("click", () => { persistCurrentCartOrder(); });

let refreshTimer;
function startRefreshTimer() { clearInterval(refreshTimer); refreshTimer = setInterval(() => refresh().catch(() => {}), 30_000); }
api("?resource=session").then(async ({ user }) => { if (!user) return; state.user = user; $("#loginView").hidden = true; $("#portalView").hidden = false; await refresh(); startRefreshTimer(); }).catch(() => {});

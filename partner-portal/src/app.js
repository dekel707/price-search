import "./styles.css";

const ORDER_WHATSAPP_PHONE = "972523685265";
const state = { user: null, products: [], customers: [], reservations: [], orders: [], cart: [], category: "", filters: {}, syncedAt: "", customerId: "", editingOrderId: "", pendingProduct: null, pendingDeleteId: "", activeTab: "search", openReservationCustomers: new Set() };
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });
const DEMO_EXPIRES_AT = "2026-07-20T22:00:00.000Z";
const DEMO_DATA = {
  products: [
    { model: "RF488", skuKey: "RF488", name: "מקרר 4 דלתות 488 ל׳", category: "מקררים", colors: ["נירוסטה"], price: 3490, stockQuantity: 6, technical: { facts: ["No Frost", "קו אפס", "מנוע אינוורטר"], dimensionsCm: { widthCm: 83, heightCm: 178, depthCm: 70 }, capacities: { totalLiters: 488, freezerLiters: 160 }, performance: { energyRating: "E" } }, documents: [] },
    { model: "WM8", skuKey: "WM8", name: "מכונת כביסה 8 ק״ג", category: "מכונות כביסה", colors: ["לבן"], price: 1890, stockQuantity: 9, technical: { facts: ["מנוע אינוורטר", "1,400 סל״ד", "תכנית מהירה"], dimensionsCm: { widthCm: 60, heightCm: 85, depthCm: 56 }, capacities: { washKg: 8 }, performance: { energyRating: "A" } }, documents: [] },
    { model: "DR9", skuKey: "DR9", name: "מייבש כביסה 9 ק״ג", category: "מייבשים", colors: ["לבן"], price: 2190, stockQuantity: 4, technical: { facts: ["משאבת חום", "חיישני לחות", "תוף גדול"], dimensionsCm: { widthCm: 60, heightCm: 85, depthCm: 63 }, capacities: { washKg: 9 }, performance: { energyRating: "A" } }, documents: [] },
    { model: "OV60", skuKey: "OV60", name: "תנור בילד־אין 60 ס״מ", category: "תנורים", colors: ["שחור"], price: 2390, stockQuantity: 3, technical: { facts: ["טורבו", "ניקוי קל", "תא אפייה גדול"], dimensionsCm: { widthCm: 60, heightCm: 60, depthCm: 56 }, capacities: { ovenLiters: 72 }, performance: { energyRating: "A" } }, documents: [] },
  ],
  customers: [
    { id: "demo-customer-sap", name: "לקוח א׳", code: "D-1001", phone: "0500000001" },
    { id: "demo-customer-north", name: "לקוח ב׳", code: "D-1002", phone: "0500000002" },
    { id: "demo-customer-direct", name: "לקוח ג׳", code: "D-1003", phone: "0500000003" },
  ],
  reservations: [
    { id: "demo-res-1", customerId: "demo-customer-sap", sku: "RF488", skuKey: "RF488", description: "מקרר 4 דלתות 488 ל׳", quantity: 2 },
    { id: "demo-res-2", customerId: "demo-customer-sap", sku: "WM8", skuKey: "WM8", description: "מכונת כביסה 8 ק״ג", quantity: 3 },
    { id: "demo-res-3", customerId: "demo-customer-north", sku: "DR9", skuKey: "DR9", description: "מייבש כביסה 9 ק״ג", quantity: 1 },
  ],
  orders: [
    { id: "demo-order-1", status: "demo", customer_name: "לקוח א׳", mainCustomerId: "demo-customer-sap", created_at: "2026-07-18T08:30:00.000Z", items: [{ model: "RF488", skuKey: "RF488", name: "מקרר 4 דלתות 488 ל׳", quantity: 1, price: 3490, unitPrice: 3490, listPrice: 3490, fromReservation: true, reservationQuantity: 1 }] },
  ],
};
let demoInitialized = false;

function isDemoMode() { return state.user?.role === "demo"; }
function demoIsAvailable() { return Date.now() < Date.parse(DEMO_EXPIRES_AT); }
function cloneDemoData() { return JSON.parse(JSON.stringify(DEMO_DATA)); }
function demoExpiryLabel() { return new Date(DEMO_EXPIRES_AT).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }); }

async function startDemoMode() {
  if (!demoIsAvailable()) {
    $("#loginMessage").textContent = "הגישה הזמנית הסתיימה.";
    return;
  }
  clearInterval(refreshTimer);
  demoInitialized = false;
  state.user = { id: "eitan-demo", role: "demo", name: "איתן" };
  state.cart = [];
  state.customerId = "";
  state.editingOrderId = "";
  state.activeTab = "search";
  state.openReservationCustomers = new Set();
  $("#loginView").hidden = true;
  $("#portalView").hidden = false;
  await refresh();
}

function configureDemoEntry() {
  const available = demoIsAvailable();
  $("#demoLogin").hidden = !available;
  $("#demoLoginHint").hidden = !available;
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
  ["#searchCustomerSelect", "#customerSelect"].forEach((selector) => {
    const input = $(selector);
    if (input) input.value = label;
  });
  const status = $("#activeOrderCustomer");
  if (status) {
    status.textContent = customer
      ? `לקוח פעיל להזמנה: ${customerLabel(customer)} · כל מוצר שתוסיף ישויך אליו עד ניקוי או שליחת ההזמנה.`
      : "בחר לקוח לפני הוספת מוצרים לסל.";
    status.classList.toggle("selected", Boolean(customer));
  }
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
  return `${product.name} ${product.model} ${product.category} ${(product.colors || []).join(" ")} ${(product.technical?.facts || []).join(" ")}`.toLowerCase().includes(query);
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
  const visible = state.products.filter((product) => matchesProductSearch(product, query)).slice(0, 80);
  $("#orderSearchResults").innerHTML = visible.map((product) => productCard(product, { ordering: true })).join("") || `<p class="muted">לא נמצאו מוצרים במחירון.</p>`;
}

function renderProducts() {
  const query = $("#advancedSearchInput").value.trim().toLowerCase();
  const categories = [...new Set(state.products.map((product) => product.category).filter(Boolean))].sort((left, right) => left.localeCompare(right, "he"));
  $("#categoryFilters").innerHTML = [`<button class="advanced-category-chip ${!state.category ? "active" : ""}" type="button" data-category="">הכול · ${state.products.length}</button>`, ...categories.map((category) => `<button class="advanced-category-chip ${state.category === category ? "active" : ""}" type="button" data-category="${escapeAttr(category)}">${escapeHtml(category)} · ${state.products.filter((product) => product.category === category).length}</button>`)].join("");
  const categorized = state.category ? state.products.filter((product) => product.category === state.category) : state.products;
  renderQuickFilters(categorized);
  const visible = categorized.filter((product) => matchesQuickFilters(product) && matchesProductSearch(product, query)).slice(0, 80);
  $("#advancedSearchStatus").textContent = visible.length ? `${visible.length} מוצרים מתאימים` : "לא נמצאו מוצרים";
  $("#productResults").innerHTML = visible.map((product) => productCard(product)).join("") || `<div class="empty-state">לא נמצאו מוצרים.</div>`;
}

function productCard(product, { ordering = false } = {}) {
  const facts = cleanFacts(product);
  const action = ordering ? `<div class="inline-add-fields"><label class="inline-add-field"><span>כמות</span><select data-quantity-for="${escapeAttr(product.model)}">${quantityOptions(1, 50)}</select></label><button class="add-cart-button" type="button" data-order-add="${escapeAttr(product.model)}">הוסף לסל</button></div>` : `<div class="advanced-readonly-actions"><span class="portal-readonly-badge">מפרט לקריאה בלבד</span></div>`;
  return `<article class="result-row"><div class="result-main"><div class="result-content"><div class="sku">${escapeHtml(product.model || "—")}</div><div class="description">${escapeHtml(product.name || product.model)}</div><div class="annotation-meta"><span class="category-label">${escapeHtml(product.category || "מוצר")}</span>${ordering ? stockLabel(product) : ""}</div>${facts ? `<div class="portal-fact-tags">${facts}</div>` : ""}${!ordering ? `${productSpecification(product)}${productDocumentLinks(product)}` : ""}</div>${ordering ? `<strong class="price">${formatPrice(product.price)}</strong>` : ""}</div><div class="item-tools">${action}</div></article>`;
}

function renderQuickFilters(products) {
  const groups = [];
  const volumeRanges = [[0, 300, "עד 300 ליטר"], [301, 450, "301–450 ליטר"], [451, 650, "451–650 ליטר"], [651, Infinity, "מעל 650 ליטר"]];
  const widthRanges = [[0, 60, "רוחב עד 60 ס״מ"], [61, 70, "רוחב 61–70 ס״מ"], [71, Infinity, "רוחב 71+ ס״מ"]];
  const heightRanges = [[0, 120, "עד 120 ס״מ"], [121, 160, "121–160 ס״מ"], [161, 180, "161–180 ס״מ"], [181, Infinity, "מעל 180 ס״מ"]];
  const depthRanges = [[0, 55, "עד 55 ס״מ"], [56, 65, "56–65 ס״מ"], [66, Infinity, "מעל 65 ס״מ"]];
  const rangeButtons = (key, ranges, getValue) => ranges
    .map(([min, max, label]) => ({ min, max, label, count: products.filter((product) => inRange(getValue(product), min, max)).length }))
    .filter((option) => option.count)
    .map((option) => quickButton(key, `${option.min}:${option.max}`, option.label, option.count));
  const numericButtons = (key, getValue, format) => [...new Set(products.map(getValue).filter((value) => Number.isFinite(Number(value))))]
    .sort((left, right) => Number(left) - Number(right))
    .slice(0, 12)
    .map((value) => quickButton(key, String(value), format(value), products.filter((product) => Number(getValue(product)) === Number(value)).length));
  const capacityButtons = rangeButtons("volume", volumeRanges, (product) => product.technical?.capacities?.totalLiters);
  const widthButtons = rangeButtons("width", widthRanges, (product) => product.technical?.dimensionsCm?.widthCm);
  const heightButtons = rangeButtons("height", heightRanges, (product) => product.technical?.dimensionsCm?.heightCm);
  const depthButtons = rangeButtons("depth", depthRanges, (product) => product.technical?.dimensionsCm?.depthCm);
  const washButtons = numericButtons("washKg", (product) => product.technical?.capacities?.washKg, (value) => `${value} ק״ג`);
  const screenButtons = numericButtons("screenSize", (product) => product.technical?.performance?.screenSizeInches, (value) => `${value} אינץ׳`);
  const spinButtons = numericButtons("spinRpm", (product) => product.technical?.performance?.spinRpm, (value) => `${Number(value).toLocaleString("he-IL")} סל״ד`);
  const colors = [...new Set(products.flatMap((product) => product.colors || []).filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right), "he"));
  const energy = [...new Set(products.map((product) => product.technical?.performance?.energyRating).filter(Boolean))].sort();
  const featureDefinitions = [["zeroLine", "קו אפס"], ["noFrost", "No Frost"], ["inverter", "מנוע אינוורטר"], ["heatPump", "משאבת חום"], ["turbo", "טורבו"]];
  const featureButtons = featureDefinitions
    .map(([value, label]) => ({ value, label, count: products.filter((product) => productMatchesFeature(product, value)).length }))
    .filter((option) => option.count)
    .map((option) => quickButton("feature", option.value, option.label, option.count));
  if (capacityButtons.length) groups.push(portalFilterGroup("נפח", capacityButtons));
  if (washButtons.length) groups.push(portalFilterGroup("קיבולת", washButtons));
  if (screenButtons.length) groups.push(portalFilterGroup("גודל מסך", screenButtons));
  if (spinButtons.length) groups.push(portalFilterGroup("מהירות סחיטה", spinButtons));
  if (widthButtons.length) groups.push(portalFilterGroup("רוחב", widthButtons));
  if (heightButtons.length) groups.push(portalFilterGroup("גובה", heightButtons));
  if (depthButtons.length) groups.push(portalFilterGroup("עומק", depthButtons));
  if (colors.length) groups.push(portalFilterGroup("צבע", colors.map((color) => quickButton("color", color, color, products.filter((product) => (product.colors || []).includes(color)).length))));
  if (energy.length) groups.push(portalFilterGroup("דירוג אנרגטי", energy.map((rating) => quickButton("energy", rating, `דירוג ${rating}`, products.filter((product) => product.technical?.performance?.energyRating === rating).length))));
  if (featureButtons.length) groups.push(portalFilterGroup("תכונות בולטות", featureButtons));
  const quickFilters = $("#quickFilters");
  quickFilters.innerHTML = groups.join("") || `<span class="portal-muted">בחר קטגוריה כדי לראות סינונים רלוונטיים.</span>`;
  quickFilters.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePortalQuickFilter(button.dataset.filter || "", button.dataset.value || "");
    });
  });
}

function portalFilterGroup(label, buttons) {
  const active = buttons.some((button) => /\bactive\b/.test(button));
  return `<details class="portal-filter-group" ${active ? "open" : ""}><summary>${escapeHtml(label)}</summary><div class="portal-filter-options">${buttons.join("")}</div></details>`;
}
function quickButton(key, value, label, count = 0) { return `<button class="advanced-filter-option ${state.filters[key] === value ? "active" : ""}" type="button" data-filter="${escapeAttr(key)}" data-value="${escapeAttr(value)}">${escapeHtml(label)}${count ? ` <small>(${Number(count).toLocaleString("he-IL")})</small>` : ""}</button>`; }
function inRange(value, min, max) { return Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max; }
function productMatchesFeature(product, feature) {
  const facts = `${product.name || ""} ${(product.technical?.facts || []).join(" ")}`;
  const matchers = {
    zeroLine: /קו\s*(אפס|0)|zero\s*-?\s*line/i,
    noFrost: /no\s*-?\s*frost/i,
    inverter: /אינוורטר|inverter/i,
    heatPump: /משאבת\s*חום|heat\s*pump/i,
    turbo: /טורבו|turbo/i,
  };
  return Boolean(matchers[feature]?.test(facts));
}
function matchesQuickFilters(product) {
  const { volume, width, height, depth, washKg, screenSize, spinRpm, color, energy, feature } = state.filters;
  if (volume) { const [min, max] = volume.split(":").map(Number); if (!inRange(product.technical?.capacities?.totalLiters, min, max)) return false; }
  if (width) { const [min, max] = width.split(":").map(Number); if (!inRange(product.technical?.dimensionsCm?.widthCm, min, max)) return false; }
  if (height) { const [min, max] = height.split(":").map(Number); if (!inRange(product.technical?.dimensionsCm?.heightCm, min, max)) return false; }
  if (depth) { const [min, max] = depth.split(":").map(Number); if (!inRange(product.technical?.dimensionsCm?.depthCm, min, max)) return false; }
  if (washKg && Number(product.technical?.capacities?.washKg) !== Number(washKg)) return false;
  if (screenSize && Number(product.technical?.performance?.screenSizeInches) !== Number(screenSize)) return false;
  if (spinRpm && Number(product.technical?.performance?.spinRpm) !== Number(spinRpm)) return false;
  if (color && !(product.colors || []).includes(color)) return false;
  if (energy && product.technical?.performance?.energyRating !== energy) return false;
  if (feature && !productMatchesFeature(product, feature)) return false;
  return true;
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
  wrap.hidden = !reservation;
  if (reservation) wrap.lastChild.textContent = ` משיכה משריון הלקוח · זמינות ${Number(reservation.quantity).toLocaleString("he-IL")} יח׳`;
  else $("#cartProductReservation").checked = false;
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
}

function renderCart() {
  const customer = findCustomer(state.customerId);
  const count = cartItemCount();
  $("#cartCount").textContent = count;
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
  const labels = { processing: "מסנכרן", sent_to_main: "נכנסה למערכת", sync_failed: "מנסה שוב לשלוח", demo: "נשמרה" };
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
  if (isDemoMode()) {
    state.orders = state.orders.filter((item) => item.id !== orderId);
    if (state.editingOrderId === orderId) cancelEdit();
    renderData();
    $("#orderActionMessage").textContent = "ההזמנה נמחקה מהתצוגה הנוכחית.";
    return;
  }
  try {
    await api("?action=delete-order", { method: "POST", body: JSON.stringify({ orderId }) });
    if (state.editingOrderId === orderId) cancelEdit();
    await refresh();
  } catch (error) { $("#orderActionMessage").textContent = `המחיקה לא הושלמה: ${error.message}`; }
}

function clearCart(message = "") {
  state.editingOrderId = "";
  state.cart = [];
  clearActiveCustomer();
  $("#cartMessage").textContent = message;
  renderCart();
}

function cancelEdit() { clearCart("עריכת ההזמנה בוטלה והסל נוקה."); }

async function refresh() {
  if (isDemoMode()) return refreshDemo();
  document.querySelectorAll(".reservation-customer-card[open]").forEach((item) => state.openReservationCustomers.add(item.dataset.reservationCustomer));
  const [live, orders] = await Promise.all([api("?resource=live"), api("?resource=orders")]);
  Object.assign(state, { products: live.products || [], customers: live.customers || [], reservations: live.reservations || [], orders: orders.items || [], syncedAt: live.updatedAt || "" });
  renderOrderSearch(); renderProducts(); renderData(); renderCart();
  const updated = state.syncedAt ? new Date(state.syncedAt).toLocaleString("he-IL") : "כעת";
  $("#portalSubtitle").textContent = "איתן · מחירון, מלאי, לקוחות ושריונים מסונכרנים לקריאה בלבד";
  $("#portalMetadata").textContent = `${live.syncMode === "cached" ? "גיבוי עדכני" : "עודכן"} ${updated} · ${state.products.length.toLocaleString("he-IL")} דגמים במלאי`;
  $("#orderSearchStatus").textContent = live.syncMode === "cached"
    ? "הגשר למערכת הראשית אינו זמין כרגע. מוצג הסנכרון האחרון שנשמר בפורטל."
    : "מוצגים רק דגמים בעלי מלאי חיובי. מלאי, מחירון, לקוחות ושריונים מתעדכנים מהמערכת הראשית.";
  setTab(state.activeTab);
}

function refreshDemo() {
  if (!demoIsAvailable()) {
    state.user = null;
    demoInitialized = false;
    document.body.classList.remove("portal-demo");
    $("#portalView").hidden = true;
    $("#loginView").hidden = false;
    $("#loginMessage").textContent = "הגישה הזמנית הסתיימה.";
    configureDemoEntry();
    return;
  }
  if (!demoInitialized) {
    Object.assign(state, cloneDemoData());
    state.syncedAt = new Date().toISOString();
    demoInitialized = true;
  }
  document.body.classList.add("portal-demo");
  $("#portalTitle").textContent = "מחירון והזמנות";
  $("#portalSubtitle").textContent = "איתן · מחירון, מלאי, לקוחות ושריונים זמינים לעבודה";
  $("#portalMetadata").textContent = `${state.products.length.toLocaleString("he-IL")} דגמים זמינים`;
  $("#orderSearchStatus").textContent = "אפשר לחפש, להוסיף לסל, ליצור, לערוך ולמחוק הזמנות. WhatsApp נפתח כטיוטה לפני שליחה.";
  renderOrderSearch(); renderProducts(); renderData(); renderCart();
  setTab(state.activeTab);
}

function sendReservationsToWhatsApp(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  const entries = state.reservations.filter((item) => item.customerId === customerId && Number(item.quantity) > 0);
  const phone = isDemoMode() ? ORDER_WHATSAPP_PHONE : String(customer?.phone || "").replace(/\D/g, "").replace(/^0/, "972");
  if (!customer || !phone || !entries.length) return;
  const text = [isDemoMode() ? "שריון עבור " + customer.name : `שריון עבור ${customer.name}`, "", ...entries.map((item) => `${item.sku || item.skuKey} · ${item.description || ""} — ${Number(item.quantity).toLocaleString("he-IL")} יח׳`)].filter(Boolean).join("\n");
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  if (isDemoMode()) $("#orderActionMessage").textContent = "נפתחה טיוטת WhatsApp לבדיקה. הנתונים הם דמיוניים ולא נשמרו במערכת.";
}

function whatsappText({ customerName, items, createdAt }) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const total = normalizedItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price ?? item.unitPrice ?? 0), 0);
  return [
    "הזמנה חדשה",
    customerName ? `לקוח: ${customerName}` : "",
    createdAt ? `תאריך: ${new Date(createdAt).toLocaleString("he-IL")}` : "",
    "",
    ...normalizedItems.map((item) => `${item.model || item.skuKey || "מוצר"} · ${item.name || ""} — ${Number(item.quantity || 0).toLocaleString("he-IL")} יח׳ × ${formatPrice(item.price ?? item.unitPrice)}${item.fromReservation ? " · שריון" : ""}`),
    "",
    `סה״כ לפי מחיר: ${formatPrice(total)}`,
  ].filter(Boolean).join("\n");
}

function openOrderWhatsApp(order) {
  if (!order) return;
  window.open(`https://wa.me/${ORDER_WHATSAPP_PHONE}?text=${encodeURIComponent(whatsappText({ customerName: order.customer_name, items: order.items, createdAt: order.created_at }))}`, "_blank", "noopener,noreferrer");
  if (isDemoMode()) $("#orderActionMessage").textContent = "נפתחה טיוטת WhatsApp לבדיקה. שליחה מתבצעת רק אם לוחצים שלח בתוך WhatsApp.";
}

function sendCartToWhatsApp() {
  const customer = findCustomer(state.customerId);
  if (!customer || !state.cart.length) { $("#cartMessage").textContent = "יש לבחור לקוח ולהוסיף מוצרים לפני שליחה בוואטסאפ."; return; }
  openOrderWhatsApp({ customer_name: customer.name, items: state.cart, created_at: new Date().toISOString() });
  if (isDemoMode()) $("#cartMessage").textContent = "נפתחה טיוטת WhatsApp לבדיקה. ההזמנה אינה נשמרת במערכת.";
}

function saveDemoOrder(customer) {
  const editing = state.editingOrderId;
  const items = state.cart.map((item) => ({ ...item, unitPrice: item.price, listPrice: item.price, reservationQuantity: item.fromReservation ? Math.min(Number(item.quantity || 0), Number(reservationFor(customer.id, item.model)?.quantity || 0)) : 0 }));
  const nextOrder = { id: editing || `demo-order-${Date.now()}`, status: "demo", customer_name: customer.name, mainCustomerId: customer.id, created_at: editing ? (state.orders.find((item) => item.id === editing)?.created_at || new Date().toISOString()) : new Date().toISOString(), items };
  state.orders = editing ? state.orders.map((item) => item.id === editing ? nextOrder : item) : [nextOrder, ...state.orders];
  state.cart = [];
  state.editingOrderId = "";
  clearActiveCustomer();
  renderData();
  renderCart();
  $("#cartMessage").textContent = editing ? "השינויים נשמרו לתצוגה הנוכחית." : "ההזמנה נוצרה לתצוגה הנוכחית.";
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#loginMessage").textContent = "מתחבר…";
  const submit = $("#loginForm button"); submit.disabled = true;
  try { const result = await api("?action=login", { method: "POST", body: JSON.stringify({ pin: $("#pin").value }) }); state.user = result.user; $("#loginView").hidden = true; $("#portalView").hidden = false; await refresh(); startRefreshTimer(); }
  catch (error) { $("#loginMessage").textContent = `לא ניתן להיכנס: ${error.message}`; }
  finally { submit.disabled = false; }
});

$("#demoLogin").addEventListener("click", () => startDemoMode().catch((error) => { $("#loginMessage").textContent = `לא ניתן לפתוח את הגישה הזמנית: ${error.message}`; }));
$("#logoutButton").addEventListener("click", async () => {
  if (isDemoMode()) { location.href = location.pathname; return; }
  await api("?action=logout", { method: "POST" }); location.reload();
});
document.querySelectorAll(".tab-button").forEach((tab) => tab.addEventListener("click", (event) => { event.preventDefault(); setTab(tab.dataset.tab); }));
$("#orderSearchInput").addEventListener("input", renderOrderSearch);
$("#advancedSearchInput").addEventListener("input", renderProducts);
$("#openCartFromSearch").addEventListener("click", () => setTab("cart"));
$("#backToOrderSearch").addEventListener("click", () => setTab("search"));
$("#portalFloatingCart").addEventListener("click", () => setTab("cart"));
$("#searchCustomerSelect").addEventListener("input", () => { if (findCustomer($("#searchCustomerSelect").value)) { selectActiveCustomer($("#searchCustomerSelect")); renderCart(); renderOrderSearch(); } });
$("#searchCustomerSelect").addEventListener("change", () => { selectActiveCustomer($("#searchCustomerSelect")); renderCart(); renderOrderSearch(); });
$("#customerSelect").addEventListener("change", () => { selectActiveCustomer($("#customerSelect")); renderCart(); renderOrderSearch(); });
$("#clearCart").addEventListener("click", () => clearCart("ההזמנה נוקתה והלקוח שוחרר."));
$("#categoryFilters").addEventListener("click", (event) => { const button = event.target.closest("[data-category]"); if (!button) return; state.category = button.dataset.category === state.category ? "" : button.dataset.category; state.filters = {}; renderProducts(); });
function togglePortalQuickFilter(filter, value) {
  if (!filter || !value) return;
  state.filters[filter] = state.filters[filter] === value ? "" : value;
  renderProducts();
}
$("#orderSearchResults").addEventListener("click", (event) => { const button = event.target.closest("[data-order-add]"); if (!button) return; const product = state.products.find((item) => item.model === button.dataset.orderAdd); const picker = button.closest(".item-tools")?.querySelector("[data-quantity-for]"); if (product) openAddDialog(product, picker?.value || 1); });
$("#cartCustomerForm").addEventListener("submit", (event) => { event.preventDefault(); addPendingToCart(); });
$("#closeCartCustomerDialog").addEventListener("click", closeAddDialog);
$("#cartCustomerDialog").addEventListener("click", (event) => { if (event.target === $("#cartCustomerDialog")) closeAddDialog(); });
$("#cartCustomerInput").addEventListener("input", updateDialogReservation);
$("#cartCustomerInput").addEventListener("change", updateDialogReservation);
$("#cartItems").addEventListener("click", (event) => { const button = event.target.closest("[data-remove]"); if (!button) return; state.cart.splice(Number(button.dataset.remove), 1); renderCart(); });
$("#cartItems").addEventListener("change", (event) => { const quantity = event.target.closest("[data-cart-quantity]"); if (quantity) { const item = state.cart[Number(quantity.dataset.cartQuantity)]; if (item) item.quantity = Number(quantity.value) || 1; renderCart(); return; } const price = event.target.closest("[data-cart-price]"); if (price) { const item = state.cart[Number(price.dataset.cartPrice)]; if (item && Number.isFinite(Number(price.value)) && Number(price.value) >= 0) item.price = Number(price.value); renderCart(); return; } const toggle = event.target.closest("[data-cart-reservation]"); if (toggle) { const item = state.cart[Number(toggle.dataset.cartReservation)]; if (item) item.fromReservation = toggle.checked; renderCart(); } });
$("#reservationList").addEventListener("click", (event) => { const button = event.target.closest("[data-send-reservations]"); if (button) sendReservationsToWhatsApp(button.dataset.sendReservations); });
$("#reservationList").addEventListener("toggle", (event) => { const details = event.target.closest?.("[data-reservation-customer]"); if (!details) return; if (details.open) state.openReservationCustomers.add(details.dataset.reservationCustomer); else state.openReservationCustomers.delete(details.dataset.reservationCustomer); }, true);
$("#orderList").addEventListener("click", (event) => { const show = event.target.closest("[data-show-order]"); const send = event.target.closest("[data-send-order]"); const edit = event.target.closest("[data-edit-order]"); const remove = event.target.closest("[data-delete-order]"); if (show) showOrder(state.orders.find((item) => item.id === show.dataset.showOrder)); if (send) openOrderWhatsApp(state.orders.find((item) => item.id === send.dataset.sendOrder)); if (edit) editOrder(state.orders.find((item) => item.id === edit.dataset.editOrder)); if (remove) openDeleteDialog(remove.dataset.deleteOrder); });
$("#closeDeleteOrderDialog").addEventListener("click", closeDeleteDialog);
$("#cancelDeleteOrder").addEventListener("click", closeDeleteDialog);
$("#confirmDeleteOrder").addEventListener("click", async () => { const orderId = state.pendingDeleteId; closeDeleteDialog(); if (orderId) await deleteOrder(orderId); });
$("#deleteOrderDialog").addEventListener("click", (event) => { if (event.target === $("#deleteOrderDialog")) closeDeleteDialog(); });
$("#cancelEditOrder").addEventListener("click", cancelEdit);
$("#sendCartWhatsApp").addEventListener("click", sendCartToWhatsApp);
$("#submitOrder").addEventListener("click", async () => {
  const customer = findCustomer(state.customerId);
  if (!customer || !state.cart.length) { $("#cartMessage").textContent = "יש לבחור לקוח ולהוסיף מוצרים."; return; }
  const displayedCustomer = resolveCustomerInput($("#customerSelect"));
  if (!displayedCustomer || displayedCustomer.id !== customer.id) { syncActiveCustomerInputs(); $("#cartMessage").textContent = "הסל משויך ללקוח הפעיל. נקה את ההזמנה כדי לבחור לקוח אחר."; return; }
  if (isDemoMode()) { saveDemoOrder(customer); return; }
  const submit = $("#submitOrder"); submit.disabled = true;
  const editing = state.editingOrderId;
  try {
    const result = await api(`?action=${editing ? "update-order" : "create-order"}`, { method: "POST", body: JSON.stringify({ ...(editing ? { orderId: editing } : {}), customerId: customer.id, items: state.cart.map((item) => ({ ...item, unitPrice: item.price })) }) });
    state.cart = []; state.editingOrderId = ""; clearActiveCustomer();
    $("#cartMessage").textContent = result.plannedReservationUnits ? `ההזמנה נשמרה. ${Number(result.plannedReservationUnits).toLocaleString("he-IL")} יח׳ מסומנות לשריון בכפוף ליתרה העדכנית.` : "ההזמנה נשמרה במערכת הראשית.";
    await refresh();
  } catch (error) { $("#cartMessage").textContent = `ההזמנה לא נשמרה: ${error.message}`; }
  finally { submit.disabled = false; }
});

let refreshTimer;
function startRefreshTimer() { clearInterval(refreshTimer); refreshTimer = setInterval(() => refresh().catch(() => {}), 30_000); }
configureDemoEntry();
const demoRequested = new URLSearchParams(window.location.search).get("demo") === "1";
if (demoRequested && demoIsAvailable()) {
  startDemoMode().catch((error) => { $("#loginMessage").textContent = `לא ניתן לפתוח את הגישה הזמנית: ${error.message}`; });
} else {
  api("?resource=session").then(async ({ user }) => { if (!user) return; state.user = user; $("#loginView").hidden = true; $("#portalView").hidden = false; await refresh(); startRefreshTimer(); }).catch(() => {});
}

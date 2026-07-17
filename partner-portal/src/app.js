import "./styles.css";

const state = { user: null, products: [], customers: [], reservations: [], aging: [], orders: [], cart: [], category: "", filters: {}, syncedAt: "" };
const $ = (selector) => document.querySelector(selector);
const money = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });

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
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
}

function formatPrice(value) { return money.format(Number(value) || 0); }
function modelKey(value) { return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, ""); }
function quantityOptions(selected, max = 50) { return Array.from({ length: max }, (_, index) => index + 1).map((value) => `<option value="${value}" ${value === Number(selected) ? "selected" : ""}>${value}</option>`).join(""); }

function renderMetrics() {
  const pending = state.orders.filter((order) => order.status === "pending_owner_approval" || order.status === "processing").length;
  const activeReservations = state.reservations.filter((item) => Number(item.quantity) > 0).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const openAging = state.aging.filter((item) => !item.paid).reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0) - Number(item.paidAmount || 0)), 0);
  const items = [["הזמנות ממתינות", pending], ["לקוחות", state.customers.length], ["יח׳ בשריונים", activeReservations], ["גיול פתוח", formatPrice(openAging)]];
  $("#metrics").innerHTML = items.map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function renderOrderSearch() {
  const query = $("#orderSearchInput").value.trim().toLowerCase();
  const visible = state.products.filter((product) => matchesProductSearch(product, query)).slice(0, 80);
  $("#orderSearchResults").innerHTML = visible.map((product) => productCard(product, { picker: true })).join("") || `<p class="muted">לא נמצאו מוצרים במחירון.</p>`;
}

function renderProducts() {
  const query = $("#advancedSearchInput").value.trim().toLowerCase();
  const categories = [...new Set(state.products.map((product) => product.category).filter(Boolean))].sort((left, right) => left.localeCompare(right, "he"));
  $("#categoryFilters").innerHTML = [`<button class="filter-chip ${!state.category ? "active" : ""}" data-category="">הכול · ${state.products.length}</button>`, ...categories.map((category) => `<button class="filter-chip ${state.category === category ? "active" : ""}" data-category="${escapeAttr(category)}">${escapeHtml(category)} · ${state.products.filter((product) => product.category === category).length}</button>`)].join("");
  const categorized = state.category ? state.products.filter((product) => product.category === state.category) : state.products;
  renderQuickFilters(categorized);
  const visible = categorized.filter((product) => matchesQuickFilters(product) && matchesProductSearch(product, query)).slice(0, 80);
  $("#productResults").innerHTML = visible.map((product) => productCard(product)).join("") || `<p class="muted">לא נמצאו מוצרים.</p>`;
}

function matchesProductSearch(product, query) {
  if (!query) return true;
  return `${product.name} ${product.model} ${product.category} ${(product.colors || []).join(" ")} ${(product.technical?.facts || []).join(" ")}`.toLowerCase().includes(query);
}

function productCard(product, { picker = false } = {}) {
  const facts = (product.technical?.facts || []).slice(0, 3).map((fact) => `<span class="tag">${escapeHtml(fact)}</span>`).join("");
  const action = picker
    ? `<div class="product-action-row"><label>כמות <select class="quantity-select" data-quantity-for="${escapeAttr(product.model)}">${quantityOptions(1, 20)}</select></label><button data-order-add="${escapeAttr(product.model)}">הוסף לסל</button></div>`
    : `<button data-advanced-add="${escapeAttr(product.model)}">הוסף לסל</button>`;
  return `<article class="product ${picker ? "order-product" : ""}"><span class="muted">${escapeHtml(product.category || "מוצר")}</span><h3>${escapeHtml(product.name || product.model)}</h3><p class="muted">דגם: ${escapeHtml(product.model || "—")}</p><strong class="list-price">${formatPrice(product.price)}</strong><div class="tags">${facts}</div>${action}</article>`;
}

function renderQuickFilters(products) {
  const groups = [];
  const volumeRanges = [[0, 300, "עד 300 ליטר"], [301, 450, "301–450 ליטר"], [451, 650, "451–650 ליטר"], [651, Infinity, "מעל 650 ליטר"]];
  const widthRanges = [[0, 60, "רוחב עד 60 ס״מ"], [61, 70, "רוחב 61–70 ס״מ"], [71, Infinity, "רוחב 71+ ס״מ"]];
  const capacityButtons = volumeRanges.filter(([min, max]) => products.some((product) => inRange(product.technical?.capacities?.totalLiters, min, max))).map(([min, max, label]) => quickButton("volume", `${min}:${max}`, label));
  const widthButtons = widthRanges.filter(([min, max]) => products.some((product) => inRange(product.technical?.dimensionsCm?.widthCm, min, max))).map(([min, max, label]) => quickButton("width", `${min}:${max}`, label));
  const washSizes = [...new Set(products.map((product) => product.technical?.capacities?.washKg).filter((value) => Number.isFinite(Number(value))))].sort((a, b) => a - b).slice(0, 10);
  const energy = [...new Set(products.map((product) => product.technical?.performance?.energyRating).filter(Boolean))].sort();
  if (capacityButtons.length) groups.push(`<span class="filter-label">נפח</span>${capacityButtons.join("")}`);
  if (washSizes.length) groups.push(`<span class="filter-label">קיבולת</span>${washSizes.map((size) => quickButton("washKg", String(size), `${size} ק״ג`)).join("")}`);
  if (widthButtons.length) groups.push(`<span class="filter-label">רוחב</span>${widthButtons.join("")}`);
  if (energy.length) groups.push(`<span class="filter-label">דירוג אנרגטי</span>${energy.map((rating) => quickButton("energy", rating, `דירוג ${rating}`)).join("")}`);
  if (products.some((product) => /קו\s*(אפס|0)|zero\s*-?\s*line/i.test((product.technical?.facts || []).join(" ")))) groups.push(quickButton("zeroLine", "yes", "קו אפס"));
  $("#quickFilters").innerHTML = groups.join("") || `<span class="muted">בחר קטגוריה כדי לראות סינונים רלוונטיים.</span>`;
}

function quickButton(key, value, label) { return `<button class="filter-chip ${state.filters[key] === value ? "active" : ""}" data-filter="${escapeAttr(key)}" data-value="${escapeAttr(value)}">${escapeHtml(label)}</button>`; }
function inRange(value, min, max) { return Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max; }
function matchesQuickFilters(product) {
  const { volume, width, washKg, energy, zeroLine } = state.filters;
  if (volume) { const [min, max] = volume.split(":").map(Number); if (!inRange(product.technical?.capacities?.totalLiters, min, max)) return false; }
  if (width) { const [min, max] = width.split(":").map(Number); if (!inRange(product.technical?.dimensionsCm?.widthCm, min, max)) return false; }
  if (washKg && Number(product.technical?.capacities?.washKg) !== Number(washKg)) return false;
  if (energy && product.technical?.performance?.energyRating !== energy) return false;
  if (zeroLine && !/קו\s*(אפס|0)|zero\s*-?\s*line/i.test((product.technical?.facts || []).join(" "))) return false;
  return true;
}

function selectedCustomer() { return state.customers.find((customer) => customer.id === $("#customerSelect").value) || null; }
function reservationFor(customerId, model) { return state.reservations.find((item) => item.customerId === customerId && modelKey(item.skuKey || item.sku) === modelKey(model) && Number(item.quantity) > 0) || null; }

function renderCart() {
  const customer = selectedCustomer();
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  $("#cartCount").textContent = count;
  $("#searchCartCount").textContent = count ? `${count} פריטים` : "ריק";
  $("#cartItems").innerHTML = state.cart.map((item, index) => {
    const reservation = customer ? reservationFor(customer.id, item.model) : null;
    const plannedReservation = item.fromReservation && reservation ? Math.min(item.quantity, Number(reservation.quantity)) : 0;
    const paidQuantity = item.quantity - plannedReservation;
    return `<article class="stack-item line cart-line"><div><strong>${escapeHtml(item.name)}</strong><p class="muted">${escapeHtml(item.model)} · ${formatPrice(item.price)} ליח׳</p>${reservation ? `<label class="reservation-choice"><input type="checkbox" data-cart-reservation="${index}" ${item.fromReservation ? "checked" : ""} /> מהשריון · זמינות ${Number(reservation.quantity).toLocaleString("he-IL")} יח׳</label>` : ""}<small>${plannedReservation ? `${plannedReservation} יח׳ מהשריון${paidQuantity ? ` · ${paidQuantity} יח׳ במחירון` : ""}` : "מהמחירון"}</small></div><div class="cart-line-actions"><label>כמות <select data-cart-quantity="${index}">${quantityOptions(item.quantity)}</select></label><button class="danger" data-remove="${index}">מחק</button></div></article>`;
  }).join("") || `<p class="muted">הסל ריק. עבור ללשונית חיפוש כדי להוסיף מוצרים.</p>`;
  const total = state.cart.reduce((sum, item) => {
    const reservation = customer && item.fromReservation ? reservationFor(customer.id, item.model) : null;
    return sum + Math.max(0, item.quantity - Math.min(item.quantity, Number(reservation?.quantity || 0))) * item.price;
  }, 0);
  $("#cartTotal").textContent = `סה״כ לתשלום לפי מחירון: ${formatPrice(total)}`;
}

function renderData() {
  const current = $("#customerSelect").value;
  $("#customerSelect").innerHTML = `<option value="">בחירת לקוח</option>${state.customers.map((customer) => `<option value="${escapeAttr(customer.id)}" ${customer.id === current ? "selected" : ""}>${escapeHtml(customer.name)}${customer.code ? ` · ${escapeHtml(customer.code)}` : ""}</option>`).join("")}`;
  $("#customerList").innerHTML = state.customers.map((item) => `<article class="stack-item line"><div><strong>${escapeHtml(item.name)}</strong><p class="muted">${escapeHtml(item.phone || "ללא טלפון")}</p></div><span class="read-only-badge">קריאה בלבד</span></article>`).join("") || `<p class="muted">אין לקוחות.</p>`;
  const reservationGroups = state.customers.map((customer) => ({ customer, items: state.reservations.filter((item) => item.customerId === customer.id && Number(item.quantity) > 0) })).filter((group) => group.items.length);
  $("#reservationList").innerHTML = reservationGroups.map(({ customer, items }) => `<article class="stack-item reservation-card"><div class="line"><div><strong>${escapeHtml(customer.name)}</strong><p class="muted">${items.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toLocaleString("he-IL")} יח׳ בשריון</p></div>${customer.phone ? `<button class="secondary" data-send-reservations="${escapeAttr(customer.id)}">שלח שריון בוואטסאפ</button>` : ""}</div>${items.map((item) => `<p class="reservation-row"><b>${escapeHtml(item.sku || item.skuKey)}</b><span>${escapeHtml(item.description || "")} · נותרו ${Number(item.quantity).toLocaleString("he-IL")}</span></p>`).join("")}</article>`).join("") || `<p class="muted">אין שריונים פעילים.</p>`;
  $("#agingList").innerHTML = state.aging.map((item) => {
    const open = Math.max(0, Number(item.amount || 0) - Number(item.paidAmount || 0));
    const details = [...(item.months || []), ...(item.invoices || [])].map((value) => typeof value === "string" ? value : value?.label || value?.number || "").filter(Boolean).join(" · ");
    return `<article class="stack-item aging-card"><div class="line"><strong>${escapeHtml(item.customerName || "לקוח")}</strong><b class="${open ? "aging-open" : ""}">${formatPrice(open)}</b></div><p class="muted">חשבון: ${escapeHtml(item.accountNumber || "—")} · סכום מקורי: ${formatPrice(item.amount)} · שולם: ${formatPrice(item.paidAmount)}</p>${item.dueDate ? `<p class="muted">מועד: ${escapeHtml(item.dueDate)}</p>` : ""}${details ? `<p class="muted">${escapeHtml(details)}</p>` : ""}${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</article>`;
  }).join("") || `<p class="muted">אין נתוני גיול.</p>`;
  $("#orderList").innerHTML = state.orders.map(orderCard).join("") || `<p class="muted">עדיין לא יצרת הזמנות.</p>`;
}

function orderCard(order) {
  const labels = { pending_owner_approval: "ממתינה לאישור דקל", processing: "בתהליך אישור", approved: "אושרה ונכנסה למערכת", cancelled: "בוטלה" };
  const items = (order.items || []).map((item) => `${item.name} ×${item.quantity}${Number(item.reservationQuantity || 0) ? ` · שריון ${item.reservationQuantity}` : ""}`).join(" · ");
  return `<article class="stack-item"><strong>${escapeHtml(order.customer_name || "לקוח")}</strong><p class="muted">${escapeHtml(items)}</p><p class="muted">${escapeHtml(labels[order.status] || order.status)} · ${new Date(order.created_at).toLocaleString("he-IL")}</p></article>`;
}

async function refresh() {
  const [live, orders] = await Promise.all([api("?resource=live"), api("?resource=orders")]);
  Object.assign(state, { products: live.products || [], customers: live.customers || [], reservations: live.reservations || [], aging: live.aging || [], orders: orders.items || [], syncedAt: live.updatedAt || "" });
  renderMetrics(); renderOrderSearch(); renderProducts(); renderData(); renderCart();
  $("#portalSubtitle").textContent = `מחירון, שריונים וגיול מהמערכת הראשית — קריאה בלבד. עודכן ${state.syncedAt ? new Date(state.syncedAt).toLocaleString("he-IL") : "כעת"}.`;
}

function addToCart(product, quantity = 1) {
  const safeQuantity = Number(quantity) || 1;
  const existing = state.cart.find((item) => modelKey(item.model) === modelKey(product.model));
  if (existing) existing.quantity += safeQuantity;
  else state.cart.push({ model: product.model, skuKey: product.skuKey || product.model, name: product.name || product.model, price: Number(product.price) || 0, quantity: safeQuantity, fromReservation: false });
  renderCart();
}

function sendReservationsToWhatsApp(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  const entries = state.reservations.filter((item) => item.customerId === customerId && Number(item.quantity) > 0);
  const phone = String(customer?.phone || "").replace(/\D/g, "").replace(/^0/, "972");
  if (!customer || !phone || !entries.length) return;
  const text = [`שריון עבור ${customer.name}`, "", ...entries.map((item) => `${item.sku || item.skuKey} · ${item.description || ""} — ${Number(item.quantity).toLocaleString("he-IL")} יח׳`)].join("\n");
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault(); $("#loginMessage").textContent = "מתחבר…";
  const submit = $("#loginForm button"); submit.disabled = true;
  try {
    const result = await api("?action=login", { method: "POST", body: JSON.stringify({ pin: $("#pin").value }) });
    state.user = result.user; $("#loginView").hidden = true; $("#portalView").hidden = false;
    await refresh(); startRefreshTimer();
  } catch (error) { $("#loginMessage").textContent = `לא ניתן להיכנס: ${error.message}`; }
  finally { submit.disabled = false; }
});

$("#logoutButton").addEventListener("click", async () => { await api("?action=logout", { method: "POST" }); location.reload(); });
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
$("#orderSearchInput").addEventListener("input", renderOrderSearch);
$("#advancedSearchInput").addEventListener("input", renderProducts);
$("#openCartFromSearch").addEventListener("click", () => setTab("cart"));
$("#backToOrderSearch").addEventListener("click", () => setTab("search"));
$("#customerSelect").addEventListener("change", () => { renderCart(); renderOrderSearch(); });
$("#categoryFilters").addEventListener("click", (event) => { const button = event.target.closest("[data-category]"); if (!button) return; state.category = button.dataset.category === state.category ? "" : button.dataset.category; state.filters = {}; renderProducts(); });
$("#quickFilters").addEventListener("click", (event) => { const button = event.target.closest("[data-filter]"); if (!button) return; const { filter, value } = button.dataset; state.filters[filter] = state.filters[filter] === value ? "" : value; renderProducts(); });
$("#orderSearchResults").addEventListener("click", (event) => { const button = event.target.closest("[data-order-add]"); if (!button) return; const product = state.products.find((item) => item.model === button.dataset.orderAdd); const picker = button.closest(".product-action-row")?.querySelector("[data-quantity-for]"); if (product) addToCart(product, picker?.value || 1); });
$("#productResults").addEventListener("click", (event) => { const button = event.target.closest("[data-advanced-add]"); if (!button) return; const product = state.products.find((item) => item.model === button.dataset.advancedAdd); if (product) { addToCart(product); setTab("cart"); } });
$("#cartItems").addEventListener("click", (event) => { const button = event.target.closest("[data-remove]"); if (!button) return; state.cart.splice(Number(button.dataset.remove), 1); renderCart(); });
$("#cartItems").addEventListener("change", (event) => { const quantity = event.target.closest("[data-cart-quantity]"); if (quantity) { const item = state.cart[Number(quantity.dataset.cartQuantity)]; if (item) item.quantity = Number(quantity.value) || 1; renderCart(); return; } const toggle = event.target.closest("[data-cart-reservation]"); if (toggle) { const item = state.cart[Number(toggle.dataset.cartReservation)]; if (item) item.fromReservation = toggle.checked; renderCart(); } });
$("#reservationList").addEventListener("click", (event) => { const button = event.target.closest("[data-send-reservations]"); if (button) sendReservationsToWhatsApp(button.dataset.sendReservations); });
$("#submitOrder").addEventListener("click", async () => {
  const customerId = $("#customerSelect").value;
  if (!customerId || !state.cart.length) { $("#cartMessage").textContent = "יש לבחור לקוח ולהוסיף מוצרים."; return; }
  const submit = $("#submitOrder"); submit.disabled = true;
  try {
    const result = await api("?action=create-order", { method: "POST", body: JSON.stringify({ customerId, items: state.cart }) });
    state.cart = [];
    $("#cartMessage").textContent = result.plannedReservationUnits ? `ההזמנה נשלחה לאישור. ${Number(result.plannedReservationUnits).toLocaleString("he-IL")} יח׳ מסומנות לשריון בכפוף ליתרה בעת האישור.` : "ההזמנה נשלחה לאישור דקל.";
    await refresh();
  } catch (error) { $("#cartMessage").textContent = `ההזמנה לא נשמרה: ${error.message}`; }
  finally { submit.disabled = false; }
});

let refreshTimer;
function startRefreshTimer() { clearInterval(refreshTimer); refreshTimer = setInterval(() => refresh().catch(() => {}), 30_000); }
api("?resource=session").then(async ({ user }) => { if (!user) return; state.user = user; $("#loginView").hidden = true; $("#portalView").hidden = false; await refresh(); startRefreshTimer(); }).catch(() => {});

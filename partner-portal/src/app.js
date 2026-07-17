import "./styles.css";

const state = { user: null, products: [], customers: [], reservations: [], aging: [], orders: [], ownerOrders: [], backups: [], cart: [], category: "", filters: {} };
const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(`/api/portal${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || "portal_request_failed");
  return data;
}

function setTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
}

function renderMetrics(dashboard = {}) {
  const items = [["הזמנות ממתינות", dashboard.pendingOrders || 0], ["הזמנות שלי", dashboard.myOrders || 0], ["משיכות משריון", dashboard.reservationWithdrawals || 0], ["לקוחות פעילים", dashboard.customers || 0]];
  $("#metrics").innerHTML = items.map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function renderProducts() {
  const query = $("#productSearch").value.trim().toLowerCase();
  const categories = [...new Set(state.products.map((product) => product.category).filter(Boolean))].sort((left, right) => left.localeCompare(right, "he"));
  $("#categoryFilters").innerHTML = [`<button class="filter-chip ${!state.category ? "active" : ""}" data-category="">הכול · ${state.products.length}</button>`, ...categories.map((category) => `<button class="filter-chip ${state.category === category ? "active" : ""}" data-category="${escapeAttr(category)}">${escapeHtml(category)} · ${state.products.filter((product) => product.category === category).length}</button>`)].join("");
  const categorized = state.category ? state.products.filter((product) => product.category === state.category) : state.products;
  renderQuickFilters(categorized);
  const visible = categorized.filter((product) => matchesQuickFilters(product) && `${product.name} ${product.model} ${product.category} ${(product.colors || []).join(" ")} ${(product.technical?.facts || []).join(" ")}`.toLowerCase().includes(query)).slice(0, 60);
  $("#productResults").innerHTML = visible.map((product) => `<article class="product"><span class="muted">${product.category || "מוצר"}</span><h3>${escapeHtml(product.name || product.model)}</h3><p class="muted">דגם: ${escapeHtml(product.model || "—")}</p><div class="tags">${(product.technical?.facts || []).slice(0, 3).map((fact) => `<span class="tag">${escapeHtml(fact)}</span>`).join("")}</div><button data-add="${escapeAttr(product.model)}">הוסף לסל</button></article>`).join("") || `<p class="muted">לא נמצאו מוצרים.</p>`;
}

function renderQuickFilters(products) {
  const filterGroups = [];
  const volumeRanges = [[0, 300, "עד 300 ליטר"], [301, 450, "301–450 ליטר"], [451, 650, "451–650 ליטר"], [651, Infinity, "מעל 650 ליטר"]];
  const widthRanges = [[0, 60, "רוחב עד 60 ס״מ"], [61, 70, "רוחב 61–70 ס״מ"], [71, Infinity, "רוחב 71+ ס״מ"]];
  const capacityButtons = volumeRanges.filter(([min, max]) => products.some((product) => inRange(product.technical?.capacities?.totalLiters, min, max))).map(([min, max, label]) => quickButton("volume", `${min}:${max}`, label));
  const widthButtons = widthRanges.filter(([min, max]) => products.some((product) => inRange(product.technical?.dimensionsCm?.widthCm, min, max))).map(([min, max, label]) => quickButton("width", `${min}:${max}`, label));
  const washSizes = [...new Set(products.map((product) => product.technical?.capacities?.washKg).filter((value) => Number.isFinite(value)))].sort((a, b) => a - b).slice(0, 10);
  const washButtons = washSizes.map((size) => quickButton("washKg", String(size), `${size} ק״ג`));
  const energyRatings = [...new Set(products.map((product) => product.technical?.performance?.energyRating).filter(Boolean))].sort();
  const energyButtons = energyRatings.map((rating) => quickButton("energy", rating, `דירוג ${rating}`));
  const zeroLine = products.some((product) => /קו\s*(אפס|0)|zero\s*-?\s*line/i.test((product.technical?.facts || []).join(" ")));
  if (capacityButtons.length) filterGroups.push(`<span class="filter-label">נפח</span>${capacityButtons.join("")}`);
  if (washButtons.length) filterGroups.push(`<span class="filter-label">קיבולת</span>${washButtons.join("")}`);
  if (widthButtons.length) filterGroups.push(`<span class="filter-label">רוחב</span>${widthButtons.join("")}`);
  if (energyButtons.length) filterGroups.push(`<span class="filter-label">דירוג אנרגטי</span>${energyButtons.join("")}`);
  if (zeroLine) filterGroups.push(quickButton("zeroLine", "yes", "קו אפס"));
  $("#quickFilters").innerHTML = filterGroups.join("") || `<span class="muted">בחר קטגוריה כדי לראות סינונים רלוונטיים.</span>`;
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

function renderCart() {
  $("#cartCount").textContent = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  $("#cartItems").innerHTML = state.cart.map((item, index) => `<article class="stack-item line"><div><strong>${escapeHtml(item.name)}</strong><p class="muted">${escapeHtml(item.model)} · ${item.quantity} יח׳</p></div><button class="danger" data-remove="${index}">הסר</button></article>`).join("") || `<p class="muted">הסל ריק.</p>`;
}

function renderRows(target, rows, formatter, empty) { $(target).innerHTML = rows.map(formatter).join("") || `<p class="muted">${empty}</p>`; }
function renderData() {
  const customerOptions = `<option value="">בחירת לקוח</option>${state.customers.map((customer) => `<option value="${escapeAttr(customer.id)}">${escapeHtml(customer.name)}</option>`).join("")}`;
  $("#customerSelect").innerHTML = customerOptions;
  document.querySelectorAll(".owner-customer-select").forEach((select) => { select.innerHTML = customerOptions; });
  renderRows("#reservationList", state.reservations, (item) => `<article class="stack-item"><strong>${escapeHtml(item.customer_name)}</strong><p class="muted">${escapeHtml(item.product_model)} · נותרו ${item.remaining_quantity} מתוך ${item.initial_quantity}</p></article>`, "אין שריונים במערכת המבודדת עדיין.");
  renderRows("#agingList", state.aging, (item) => `<article class="stack-item line"><strong>${escapeHtml(item.customer_name)}</strong><span>₪ ${Number(item.outstanding_amount || 0).toLocaleString("he-IL")}</span></article>`, "אין נתוני גיול במערכת המבודדת עדיין.");
  renderRows("#orderList", state.orders, orderCard, "עדיין לא יצרת הזמנות.");
  if (state.user?.role === "owner") {
    renderRows("#ownerOrderList", state.ownerOrders, (item) => `<article class="stack-item owner-order"><div><strong>${escapeHtml(item.customer_name)}</strong><p class="muted">${orderItemsSummary(item.items)} · ${new Date(item.created_at).toLocaleString("he-IL")}</p></div>${item.status === "pending_owner_approval" ? `<button data-approve="${escapeAttr(item.id)}">אשר בפיילוט</button>` : `<span class="tag">אושר בפיילוט</span>`}</article>`, "אין הזמנות ממתינות של איתן.");
    const latestBackup = state.backups[0];
    $("#ownerBackupInfo").textContent = latestBackup ? `גיבוי אחרון: ${new Date(latestBackup.created_at).toLocaleString("he-IL")} · ${latestBackup.reason}` : "גיבוי ייווצר לפני ואחרי כל פעולה, וגם מדי יום.";
  }
}

async function refresh() {
  const requests = [api("?resource=dashboard"), api("?resource=catalog"), api("?resource=customers"), api("?resource=reservations"), api("?resource=aging"), api("?resource=orders")];
  if (state.user?.role === "owner") requests.push(api("?resource=owner-orders"), api("?resource=backups"));
  const results = await Promise.all(requests);
  const [dashboard, catalog, customers, reservations, aging, orders, ownerOrders = { items: [] }, backups = { items: [] }] = results;
  Object.assign(state, { products: catalog.products || [], customers: customers.items || [], reservations: reservations.items || [], aging: aging.items || [], orders: orders.items || [], ownerOrders: ownerOrders.items || [], backups: backups.items || [] });
  renderMetrics(dashboard); renderProducts(); renderData(); renderCart();
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[char]); }
function escapeAttr(value) { return escapeHtml(value).replace(/`/g, ""); }
function orderItemsSummary(items) { return (items || []).map((item) => `${escapeHtml(item.name)} ×${item.quantity}${Number(item.reservationQuantity || 0) ? ` (שריון ${item.reservationQuantity})` : ""}`).join(" · ") || "ללא פריטים"; }
function orderCard(item) { return `<article class="stack-item"><strong>${escapeHtml(item.customer_name)}</strong><p class="muted">${orderItemsSummary(item.items)}</p><p class="muted">${escapeHtml(item.status)} · ${new Date(item.created_at).toLocaleString("he-IL")}</p></article>`; }
function applyRole() {
  const owner = state.user?.role === "owner";
  document.querySelectorAll("[data-owner-only]").forEach((element) => { element.hidden = !owner; });
  $("#portalTitle").textContent = owner ? "ניהול הזמנות איתן" : "הזמנות איתן";
  $("#portalSubtitle").textContent = owner ? "מסך בעלים מבודד לפיילוט השותפים." : "גישה להזמנות בלבד — פעולות ניהול נשארות אצל דקל.";
}
let refreshTimer;
function startRefreshTimer() { clearInterval(refreshTimer); refreshTimer = setInterval(() => refresh().catch(() => {}), 30000); }

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginMessage").textContent = "מתחבר…";
  try {
    const result = await api("?action=login", { method: "POST", body: JSON.stringify({ pin: $("#pin").value }) });
    state.user = result.user; applyRole(); $("#loginView").hidden = true; $("#portalView").hidden = false; await refresh(); startRefreshTimer();
  } catch (error) { $("#loginMessage").textContent = `לא ניתן להיכנס: ${error.message}`; }
});

$("#logoutButton").addEventListener("click", async () => { await api("?action=logout", { method: "POST" }); location.reload(); });
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
$("#productSearch").addEventListener("input", renderProducts);
$("#categoryFilters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]"); if (!button) return;
  state.category = button.dataset.category === state.category ? "" : button.dataset.category;
  state.filters = {}; renderProducts();
});
$("#quickFilters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]"); if (!button) return;
  const { filter, value } = button.dataset;
  state.filters[filter] = state.filters[filter] === value ? "" : value;
  renderProducts();
});
$("#productResults").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add]"); if (!button) return;
  const product = state.products.find((item) => item.model === button.dataset.add); if (!product) return;
  const existing = state.cart.find((item) => item.model === product.model); if (existing) existing.quantity += 1; else state.cart.push({ model: product.model, name: product.name || product.model, quantity: 1 });
  renderCart(); setTab("cart");
});
$("#cartItems").addEventListener("click", (event) => { const button = event.target.closest("[data-remove]"); if (!button) return; state.cart.splice(Number(button.dataset.remove), 1); renderCart(); });
$("#submitOrder").addEventListener("click", async () => {
  const customerId = $("#customerSelect").value; if (!customerId || !state.cart.length) { $("#cartMessage").textContent = "יש לבחור לקוח ולהוסיף מוצרים."; return; }
  try {
    const result = await api("?action=create-order", { method: "POST", body: JSON.stringify({ customerId, items: state.cart }) });
    state.cart = [];
    const withdrawn = (result.reservationWithdrawals || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    $("#cartMessage").textContent = withdrawn ? `ההזמנה נשלחה לאישור. נמשכו ${withdrawn} יח׳ מהשריונים המתאימים, וכל הפעולה גובתה.` : "ההזמנה נשלחה לאישור ונרשמה ביומן הפעילות.";
    await refresh();
  } catch (error) { $("#cartMessage").textContent = `ההזמנה לא נשמרה: ${error.message}`; }
});

async function saveOwnerEntity(form, entity) {
  const values = Object.fromEntries(new FormData(form));
  $("#ownerMessage").textContent = "שומר ומגבה…";
  try { await api("?action=save-entity", { method: "POST", body: JSON.stringify({ entity, values }) }); form.reset(); $("#ownerMessage").textContent = "נשמר בפיילוט המבודד ונוצרו גיבויים."; await refresh(); } catch (error) { $("#ownerMessage").textContent = `לא נשמר: ${error.message}`; }
}
$("#customerForm").addEventListener("submit", (event) => { event.preventDefault(); saveOwnerEntity(event.currentTarget, "customer"); });
$("#reservationForm").addEventListener("submit", (event) => { event.preventDefault(); saveOwnerEntity(event.currentTarget, "reservation"); });
$("#agingForm").addEventListener("submit", (event) => { event.preventDefault(); saveOwnerEntity(event.currentTarget, "aging"); });
$("#ownerOrderList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-approve]"); if (!button) return;
  try { await api("?action=approve-order", { method: "POST", body: JSON.stringify({ orderId: button.dataset.approve }) }); $("#ownerMessage").textContent = "ההזמנה אושרה בפיילוט המבודד. המערכת הראשית לא שונתה."; await refresh(); } catch (error) { $("#ownerMessage").textContent = `לא ניתן לאשר: ${error.message}`; }
});
$("#seedDemo").addEventListener("click", async () => {
  if (!confirm("ליצור נתוני בדיקה במסד הנתונים החדש בלבד? אין לכך השפעה על האתר הראשי.")) return;
  try { await api("?action=seed-demo", { method: "POST" }); $("#ownerMessage").textContent = "נוצרו נתוני בדיקה במסד החדש בלבד, עם גיבויים לפני ואחרי."; await refresh(); } catch (error) { $("#ownerMessage").textContent = `לא ניתן ליצור נתוני בדיקה: ${error.message}`; }
});

api("?resource=session").then(async ({ user }) => { if (!user) return; state.user = user; applyRole(); $("#loginView").hidden = true; $("#portalView").hidden = false; await refresh(); startRefreshTimer(); }).catch(() => {});

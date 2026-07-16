import "./styles.css";

const SOURCE_ORIGIN = String(window.CATALOG_SOURCE_ORIGIN || "https://price-search-teal.vercel.app").replace(/\/+$/, "");
const CATALOG_ENDPOINT = `${SOURCE_ORIGIN}/api/dealer-catalog`;
const CACHE_KEY = "fujicom-dealer-catalog-v1";

const dom = {
  search: document.querySelector("#catalogSearch"),
  clearSearch: document.querySelector("#clearSearch"),
  colorFilters: document.querySelector("#colorFilters"),
  clearColor: document.querySelector("#clearColor"),
  summary: document.querySelector("#catalogSummary"),
  updated: document.querySelector("#catalogUpdated"),
  status: document.querySelector("#catalogStatus"),
  results: document.querySelector("#catalogResults"),
};

let products = [];
let activeColor = "";

boot();

async function boot() {
  bindEvents();
  const catalog = await loadCatalog();
  products = normalizeProducts(catalog.products);
  renderColorFilters();
  render();
  dom.updated.textContent = catalog.updatedAt ? `עודכן ${formatDate(catalog.updatedAt)}` : "קטלוג דגמים";
}

function bindEvents() {
  dom.search.addEventListener("input", render);
  dom.clearSearch.addEventListener("click", () => {
    dom.search.value = "";
    dom.search.focus();
    render();
  });
  dom.colorFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-color]");
    if (!button) return;
    activeColor = button.dataset.color || "";
    renderColorFilters();
    render();
  });
  dom.clearColor.addEventListener("click", () => {
    activeColor = "";
    renderColorFilters();
    render();
  });
}

async function loadCatalog() {
  try {
    const response = await fetch(CATALOG_ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error("live_catalog_unavailable");
    const data = await response.json();
    const cleaned = normalizeProducts(data.products);
    if (!cleaned.length) throw new Error("live_catalog_empty");
    const catalog = { products: cleaned, updatedAt: data.updatedAt || null, source: "live" };
    localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
    dom.status.textContent = "הקטלוג מחובר למקור הנתונים המעודכן.";
    return catalog;
  } catch {
    const saved = readCachedCatalog();
    if (saved?.products?.length) {
      dom.status.textContent = "מוצגת גרסה שמורה של הקטלוג עד לחידוש החיבור.";
      return saved;
    }
    const response = await fetch("/catalog-fallback.json", { cache: "no-store" });
    if (!response.ok) throw new Error("catalog_fallback_unavailable");
    const fallback = await response.json();
    dom.status.textContent = "מוצגת גרסת גיבוי של הקטלוג.";
    return fallback;
  }
}

function readCachedCatalog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeProducts(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const model = cleanString(item?.model);
      const name = cleanString(item?.name);
      if (!model || !name || seen.has(model.toUpperCase())) return null;
      seen.add(model.toUpperCase());
      return {
        model,
        name,
        colors: [...new Set((Array.isArray(item?.colors) ? item.colors : []).map(cleanString).filter(Boolean))],
        documents: (Array.isArray(item?.documents) ? item.documents : [])
          .map((document) => ({ label: cleanString(document?.label), url: cleanString(document?.url), type: cleanString(document?.type) }))
          .filter((document) => document.label && document.url),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.model.localeCompare(right.model, "en"));
}

function renderColorFilters() {
  const colors = [...new Set(products.flatMap((product) => product.colors))].sort((left, right) => left.localeCompare(right, "he"));
  dom.colorFilters.replaceChildren(
    ...colors.map((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "color-filter";
      button.dataset.color = color;
      button.setAttribute("aria-pressed", String(activeColor === color));
      button.textContent = color;
      return button;
    }),
  );
  dom.clearColor.hidden = !activeColor;
}

function render() {
  const query = normalizeSearch(dom.search.value);
  const visible = products.filter((product) => matchesProduct(product, query) && (!activeColor || product.colors.includes(activeColor)));
  dom.clearSearch.hidden = !dom.search.value;
  dom.summary.textContent = query || activeColor
    ? `${visible.length.toLocaleString("he-IL")} התאמות`
    : `${products.length.toLocaleString("he-IL")} דגמים זמינים בקטלוג`;

  if (!visible.length) {
    dom.results.innerHTML = `<div class="empty-state"><strong>לא נמצאו דגמים מתאימים</strong><span>נסה שם מוצר, דגם או צבע אחר.</span></div>`;
    return;
  }

  dom.results.innerHTML = visible.map(renderProductCard).join("");
}

function matchesProduct(product, query) {
  if (!query) return true;
  const haystack = normalizeSearch(`${product.model} ${product.name} ${product.colors.join(" ")}`);
  return query.split(" ").every((term) => haystack.includes(term));
}

function renderProductCard(product) {
  const colors = product.colors.length
    ? `<div class="color-tags">${product.colors.map((color) => `<span>${escapeHtml(color)}</span>`).join("")}</div>`
    : "";
  const documents = product.documents.length
    ? `<div class="document-actions">${product.documents.map((document) => `<a href="${escapeAttribute(document.url)}" target="_blank" rel="noreferrer" class="document-link ${escapeAttribute(document.type)}"><span>${document.type === "installation" ? "⌁" : "▤"}</span>${escapeHtml(document.label)}</a>`).join("")}</div>`
    : `<p class="no-document">אין עדיין מסמך זמין לדגם זה.</p>`;
  return `
    <article class="product-card">
      <div class="product-card-topline"><span class="model-label">דגם</span><code>${escapeHtml(product.model)}</code></div>
      <h2>${escapeHtml(product.name)}</h2>
      ${colors}
      ${documents}
    </article>
  `;
}

function normalizeSearch(value) {
  return cleanString(value).toLocaleLowerCase("he-IL");
}

function cleanString(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "לא ידוע" : date.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

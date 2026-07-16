import "./styles.css";

const SOURCE_ORIGIN = String(window.CATALOG_SOURCE_ORIGIN || "https://price-search-teal.vercel.app").replace(/\/+$/, "");
const CATALOG_ENDPOINT = `${SOURCE_ORIGIN}/api/dealer-catalog`;
const CACHE_KEY = "fujicom-dealer-catalog-v2";

const VOLUME_RANGES = [
  ["up-to-100", "עד 100 ליטר", 0, 100],
  ["101-to-300", "101–300 ליטר", 101, 300],
  ["301-to-450", "301–450 ליטר", 301, 450],
  ["451-to-600", "451–600 ליטר", 451, 600],
  ["over-600", "מעל 600 ליטר", 601, Infinity],
];

const HEIGHT_RANGES = [
  ["up-to-100", "עד 100 ס״מ", 0, 100],
  ["101-to-170", "101–170 ס״מ", 101, 170],
  ["171-to-185", "171–185 ס״מ", 171, 185],
  ["186-to-200", "186–200 ס״מ", 186, 200],
  ["over-200", "מעל 200 ס״מ", 201, Infinity],
];

const WIDTH_RANGES = [
  ["up-to-50", "עד 50 ס״מ", 0, 50],
  ["51-to-60", "51–60 ס״מ", 51, 60],
  ["61-to-70", "61–70 ס״מ", 61, 70],
  ["71-to-90", "71–90 ס״מ", 71, 90],
  ["over-90", "מעל 90 ס״מ", 91, Infinity],
];

const FEATURE_FILTERS = [
  ["no-frost", "❄ No Frost", (facts) => /no\s*frost|frost\s*no/.test(facts)],
  ["inverter", "ϟ מנוע אינוורטר", (facts) => /inverter|אינוורטר/.test(facts)],
  ["4k", "✦ 4K", (facts) => /\b4k\b|\buhd\b/.test(facts)],
  ["smart", "◉ Smart TV", (facts) => /smart/.test(facts)],
  ["wifi", "⌁ Wi‑Fi", (facts) => /wi\s*-?\s*fi|wifi/.test(facts)],
  ["heat-pump", "♨ Heat Pump", (facts) => /heat\s*pump|משאבת חום/.test(facts)],
  ["induction", "◎ אינדוקציה", (facts) => /אינדוקציה/.test(facts)],
];

const dom = {
  search: document.querySelector("#catalogSearch"),
  clearSearch: document.querySelector("#clearSearch"),
  categoryFilters: document.querySelector("#categoryFilters"),
  clearCategory: document.querySelector("#clearCategory"),
  simpleFilters: document.querySelector("#simpleFilters"),
  clearFilters: document.querySelector("#clearFilters"),
  summary: document.querySelector("#catalogSummary"),
  updated: document.querySelector("#catalogUpdated"),
  status: document.querySelector("#catalogStatus"),
  results: document.querySelector("#catalogResults"),
};

let products = [];
let activeCategory = "";
const activeFacets = { color: "", energy: "", volume: "", height: "", width: "", feature: "" };

boot();

async function boot() {
  bindEvents();
  const catalog = await loadCatalog();
  products = normalizeProducts(catalog.products);
  renderCategoryFilters();
  renderSimpleFilters();
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
  dom.categoryFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const selectedCategory = button.dataset.category || "";
    activeCategory = activeCategory === selectedCategory ? "" : selectedCategory;
    renderCategoryFilters();
    render();
  });
  dom.clearCategory.addEventListener("click", () => {
    activeCategory = "";
    renderCategoryFilters();
    render();
  });
  dom.simpleFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter-group]");
    if (!button) return;
    const group = button.dataset.filterGroup || "";
    const value = button.dataset.filterValue || "";
    if (!(group in activeFacets) || !value) return;
    activeFacets[group] = activeFacets[group] === value ? "" : value;
    renderSimpleFilters();
    render();
  });
  dom.clearFilters.addEventListener("click", () => {
    activeCategory = "";
    Object.keys(activeFacets).forEach((key) => { activeFacets[key] = ""; });
    renderCategoryFilters();
    renderSimpleFilters();
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
    const catalog = { products: data.products, updatedAt: data.updatedAt || null, source: "live" };
    localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
    dom.status.textContent = "הקטלוג מחובר למפרטים הטכניים המעודכנים.";
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
      const modelKey = model.toUpperCase();
      if (!model || !name || seen.has(modelKey)) return null;
      seen.add(modelKey);
      const technical = normalizeTechnical(item?.technical);
      const category = cleanString(item?.category) || technical.category || "אחר";
      const colors = [...new Set((Array.isArray(item?.colors) ? item.colors : []).concat(technical.colors).map(cleanString).filter(Boolean))];
      return {
        model,
        name,
        category,
        colors,
        technical,
        documents: (Array.isArray(item?.documents) ? item.documents : [])
          .map((document) => ({ label: cleanString(document?.label), url: cleanString(document?.url), type: cleanString(document?.type) }))
          .filter((document) => document.label && document.url),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.model.localeCompare(right.model, "en"));
}

function normalizeTechnical(value) {
  const technical = value && typeof value === "object" ? value : {};
  const dimensionsCm = numericRecord(technical.dimensionsCm, ["widthCm", "heightCm", "depthCm"]);
  const capacities = numericRecord(technical.capacities, ["totalLiters", "fridgeLiters", "freezerLiters", "ovenLiters", "bottleCount", "placeSettings", "washKg"]);
  const performance = numericRecord(technical.performance, ["powerW", "programCount", "noiseDb", "waterConsumptionLiters", "spinRpm", "airflowM3h", "screenSizeInches"]);
  const displayDimensionsMm = {
    withoutStand: numericRecord(technical.displayDimensionsMm?.withoutStand, ["widthMm", "heightMm", "depthMm"]),
    withStand: numericRecord(technical.displayDimensionsMm?.withStand, ["widthMm", "heightMm", "depthMm"]),
  };
  const temperatureRangeC = numericRange(technical.performance?.temperatureRangeC);
  const resolutionPixels = numericRecord(technical.performance?.resolutionPixels, ["width", "height"]);
  return {
    category: cleanString(technical.category),
    colors: [...new Set((Array.isArray(technical.colors) ? technical.colors : []).map(cleanString).filter(Boolean))],
    dimensionsCm,
    capacities,
    performance: {
      ...performance,
      ...(cleanString(technical.performance?.energyRating) ? { energyRating: cleanString(technical.performance.energyRating) } : {}),
      ...(temperatureRangeC ? { temperatureRangeC } : {}),
      ...(Object.keys(resolutionPixels).length ? { resolutionPixels } : {}),
    },
    displayDimensionsMm,
    ...(isFiniteNumber(technical.weightKg) ? { weightKg: Number(technical.weightKg) } : {}),
    barcodes: [...new Set((Array.isArray(technical.barcodes) ? technical.barcodes : [])
      .map(cleanString)
      .filter((barcode) => /^\d{10,14}$/.test(barcode)))],
    facts: [...new Set((Array.isArray(technical.facts) ? technical.facts : []).map(cleanString).filter(Boolean))].slice(0, 80),
  };
}

function renderCategoryFilters() {
  const counts = countBy(products, (product) => product.category);
  dom.categoryFilters.replaceChildren(...[...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "he"))
    .map(([category, count]) => createFilterButton("category", category, `${category} · ${count}`, activeCategory === category)));
  dom.clearCategory.hidden = !activeCategory;
}

function renderSimpleFilters() {
  const groups = getSimpleFilterGroups();
  dom.simpleFilters.replaceChildren(...groups.map(createSimpleFilterGroup));
  dom.clearFilters.hidden = !hasActiveSimpleFilters() && !activeCategory;
}

function render() {
  const query = normalizeSearch(dom.search.value);
  const visible = products.filter((product) => (
    matchesProduct(product, query)
    && (!activeCategory || product.category === activeCategory)
    && matchesSimpleFilters(product)
  ));
  dom.clearSearch.hidden = !dom.search.value;
  const hasFilters = Boolean(query || activeCategory || hasActiveSimpleFilters());
  dom.summary.textContent = hasFilters
    ? `${visible.length.toLocaleString("he-IL")} התאמות`
    : `${products.length.toLocaleString("he-IL")} דגמים זמינים בקטלוג`;

  if (!visible.length) {
    dom.results.innerHTML = `<div class="empty-state"><strong>לא נמצאו דגמים מתאימים</strong><span>נסה קטגוריה אחרת או נקה אחת מהבחירות.</span></div>`;
    return;
  }
  dom.results.innerHTML = visible.map(renderProductCard).join("");
}

function matchesProduct(product, query) {
  if (!query) return true;
  const rows = getSpecificationRows(product).map((row) => `${row.label} ${row.value}`);
  const haystack = normalizeSearch([
    product.model,
    product.name,
    product.category,
    product.colors.join(" "),
    rows.join(" "),
    product.technical.facts.join(" "),
  ].join(" "));
  return query.split(" ").every((term) => haystack.includes(term));
}

function getProductFacts(product) {
  return normalizeSearch([product.name, ...product.technical.facts].join(" "));
}

function matchesSimpleFilters(product) {
  return (!activeFacets.color || product.colors.includes(activeFacets.color))
    && (!activeFacets.energy || product.technical.performance.energyRating === activeFacets.energy)
    && (!activeFacets.volume || matchesRange(product.technical.capacities.totalLiters, getRange(VOLUME_RANGES, activeFacets.volume)))
    && (!activeFacets.height || matchesRange(product.technical.dimensionsCm.heightCm, getRange(HEIGHT_RANGES, activeFacets.height)))
    && (!activeFacets.width || matchesRange(product.technical.dimensionsCm.widthCm, getRange(WIDTH_RANGES, activeFacets.width)))
    && (!activeFacets.feature || matchesFeature(product, activeFacets.feature));
}

function getSimpleFilterGroups() {
  const colorOptions = [...countBy(products.flatMap((product) => product.colors), (color) => color).entries()]
    .sort(([left], [right]) => left.localeCompare(right, "he"))
    .map(([value, count]) => ({ value, label: value, count }));
  const energyOptions = [...countBy(products, (product) => product.technical.performance.energyRating).entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([value, count]) => ({ value, label: `דירוג ${value}`, count }));
  const featureOptions = FEATURE_FILTERS.map(([value, label]) => ({
    value,
    label,
    count: products.filter((product) => matchesFeature(product, value)).length,
  })).filter((option) => option.count);
  return [
    { key: "color", label: "צבע", options: colorOptions },
    { key: "energy", label: "דירוג אנרגטי", options: energyOptions },
    { key: "feature", label: "תכונות בולטות", options: featureOptions },
    { key: "volume", label: "נפח", options: createRangeOptions(VOLUME_RANGES, (product) => product.technical.capacities.totalLiters) },
    { key: "height", label: "גובה", options: createRangeOptions(HEIGHT_RANGES, (product) => product.technical.dimensionsCm.heightCm) },
    { key: "width", label: "רוחב", options: createRangeOptions(WIDTH_RANGES, (product) => product.technical.dimensionsCm.widthCm) },
  ].filter((group) => group.options.length);
}

function createSimpleFilterGroup(group) {
  const details = document.createElement("details");
  details.className = "simple-filter-group";
  details.open = Boolean(activeFacets[group.key]) || group.key === "color" || group.key === "energy";
  const summary = document.createElement("summary");
  summary.textContent = group.label;
  const options = document.createElement("div");
  options.className = "simple-filter-options";
  group.options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "simple-filter-option";
    button.dataset.filterGroup = group.key;
    button.dataset.filterValue = option.value;
    button.setAttribute("aria-pressed", String(activeFacets[group.key] === option.value));
    button.textContent = `${option.label} (${option.count})`;
    options.append(button);
  });
  details.append(summary, options);
  return details;
}

function createRangeOptions(ranges, getValue) {
  return ranges.map(([value, label, minimum, maximum]) => ({
    value,
    label,
    count: products.filter((product) => matchesRange(getValue(product), { minimum, maximum })).length,
  })).filter((option) => option.count);
}

function getRange(ranges, value) {
  const found = ranges.find(([rangeValue]) => rangeValue === value);
  return found ? { minimum: found[2], maximum: found[3] } : null;
}

function matchesRange(value, range) {
  return Boolean(range) && isFiniteNumber(value) && Number(value) >= range.minimum && Number(value) <= range.maximum;
}

function matchesFeature(product, value) {
  const feature = FEATURE_FILTERS.find(([featureValue]) => featureValue === value);
  return Boolean(feature?.[2](getProductFacts(product)));
}

function hasActiveSimpleFilters() {
  return Object.values(activeFacets).some(Boolean);
}

function renderProductCard(product) {
  const colors = product.colors.length
    ? `<div class="color-tags">${product.colors.map((color) => `<span>${escapeHtml(color)}</span>`).join("")}</div>`
    : "";
  const rows = getSpecificationRows(product);
  const keyMetrics = rows.slice(0, 5);
  const metrics = keyMetrics.length
    ? `<div class="metric-tags">${keyMetrics.map((row) => `<span><b>${escapeHtml(row.label)}</b>${escapeHtml(row.value)}</span>`).join("")}</div>`
    : "";
  const highlights = getProductHighlights(product);
  const highlightTags = highlights.length
    ? `<ul class="product-highlights" aria-label="עיקרי המוצר">${highlights.map((highlight) => `<li title="${escapeAttribute(highlight.label)}"><span aria-hidden="true">${escapeHtml(highlight.icon)}</span>${escapeHtml(highlight.label)}</li>`).join("")}</ul>`
    : "";
  const technicalDetails = rows.length || product.technical.facts.length
    ? `<details class="technical-details"><summary>מפרט טכני מלא</summary>${rows.length ? `<dl class="specification-grid">${rows.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join("")}</dl>` : ""}${product.technical.facts.length ? `<ul class="technical-facts">${product.technical.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>` : ""}</details>`
    : "";
  const documents = product.documents.length
    ? `<div class="document-actions">${product.documents.map((document) => `<a href="${escapeAttribute(document.url)}" target="_blank" rel="noreferrer" class="document-link ${escapeAttribute(document.type)}"><span>${document.type === "installation" ? "⌁" : "▤"}</span>${escapeHtml(document.label)}</a>`).join("")}</div>`
    : `<p class="no-document">אין עדיין מסמך זמין לדגם זה.</p>`;
  return `
    <article class="product-card">
      <div class="product-card-topline"><span class="category-label">${escapeHtml(product.category)}</span><code>${escapeHtml(product.model)}</code></div>
      <h2>${escapeHtml(product.name)}</h2>
      ${colors}
      ${highlightTags}
      ${metrics}
      ${technicalDetails}
      ${documents}
    </article>
  `;
}

function getProductHighlights(product) {
  const technical = product.technical;
  const facts = getProductFacts(product);
  const highlights = [];
  const add = (icon, label) => {
    if (!highlights.some((highlight) => highlight.label === label)) highlights.push({ icon, label });
  };

  if (technical.performance.resolutionPixels?.width >= 3840 || /\b4k\b|\buhd\b/.test(facts)) add("✦", "4K Ultra HD");
  if (/smart/.test(facts)) add("◉", "Smart TV");
  if (/wi\s*-?\s*fi|wifi/.test(facts)) add("⌁", "Wi‑Fi");
  if (/no\s*frost|frost\s*no/.test(facts)) add("❄", "No Frost");
  if (/inverter|אינוורטר/.test(facts)) add("ϟ", "מנוע אינוורטר");
  if (/heat\s*pump|משאבת חום/.test(facts)) add("♨", "Heat Pump");
  if (/אינדוקציה/.test(facts)) add("◎", "אינדוקציה");

  if (isFiniteNumber(technical.capacities.totalLiters)) add("▣", `נפח ${formatNumber(technical.capacities.totalLiters)} ל׳`);
  else if (isFiniteNumber(technical.capacities.washKg)) add("▣", `קיבולת ${formatNumber(technical.capacities.washKg)} ק״ג`);
  else if (isFiniteNumber(technical.capacities.ovenLiters)) add("▣", `נפח ${formatNumber(technical.capacities.ovenLiters)} ל׳`);
  else if (isFiniteNumber(technical.performance.screenSizeInches)) add("▣", `${formatNumber(technical.performance.screenSizeInches)} אינץ׳`);

  if (isFiniteNumber(technical.performance.spinRpm)) add("↻", `${formatNumber(technical.performance.spinRpm)} סל״ד`);
  if (isFiniteNumber(technical.performance.powerW)) add("ϟ", `${formatNumber(technical.performance.powerW)}W`);
  if (technical.performance.energyRating) add("◎", `דירוג ${technical.performance.energyRating}`);
  return highlights.slice(0, 4);
}

function getSpecificationRows(product) {
  const technical = product.technical;
  const rows = [];
  const dimensions = technical.dimensionsCm;
  if (dimensions.widthCm || dimensions.heightCm || dimensions.depthCm) {
    rows.push(["מידות", joinParts([["רוחב", dimensions.widthCm, "ס״מ"], ["גובה", dimensions.heightCm, "ס״מ"], ["עומק", dimensions.depthCm, "ס״מ"]])]);
  }
  const withoutStand = technical.displayDimensionsMm.withoutStand;
  if (withoutStand.widthMm || withoutStand.heightMm || withoutStand.depthMm) {
    rows.push(["מידות ללא מעמד", joinParts([["רוחב", divideByTen(withoutStand.widthMm), "ס״מ"], ["גובה", divideByTen(withoutStand.heightMm), "ס״מ"], ["עומק", divideByTen(withoutStand.depthMm), "ס״מ"]])]);
  }
  const withStand = technical.displayDimensionsMm.withStand;
  if (withStand.widthMm || withStand.heightMm || withStand.depthMm) {
    rows.push(["מידות כולל מעמד", joinParts([["רוחב", divideByTen(withStand.widthMm), "ס״מ"], ["גובה", divideByTen(withStand.heightMm), "ס״מ"], ["עומק", divideByTen(withStand.depthMm), "ס״מ"]])]);
  }
  if (technical.weightKg) rows.push(["משקל", `${formatNumber(technical.weightKg)} ק״ג`]);
  const capacities = technical.capacities;
  const capacityLabels = [["totalLiters", "נפח כללי", "ליטר"], ["fridgeLiters", "תא מזון", "ליטר"], ["freezerLiters", "תא הקפאה", "ליטר"], ["ovenLiters", "תא אפייה", "ליטר"], ["washKg", "קיבולת", "ק״ג"], ["placeSettings", "מערכות כלים", ""], ["bottleCount", "בקבוקים", ""]];
  capacityLabels.forEach(([key, label, unit]) => {
    if (capacities[key] !== undefined) rows.push([label, `${formatNumber(capacities[key])}${unit ? ` ${unit}` : ""}`]);
  });
  const performance = technical.performance;
  const performanceLabels = [["energyRating", "דירוג אנרגטי", ""], ["powerW", "הספק", "W"], ["programCount", "תוכניות", ""], ["spinRpm", "סל״ד", ""], ["noiseDb", "רמת רעש", "dB"], ["waterConsumptionLiters", "צריכת מים", "ליטר"], ["airflowM3h", "עוצמת יניקה", "מ״ק/שעה"], ["screenSizeInches", "גודל מסך", "אינץ׳"]];
  performanceLabels.forEach(([key, label, unit]) => {
    if (performance[key] !== undefined) rows.push([label, `${formatNumber(performance[key])}${unit ? ` ${unit}` : ""}`]);
  });
  if (performance.temperatureRangeC) rows.push(["טווח טמפרטורה", `${formatNumber(performance.temperatureRangeC.min)}–${formatNumber(performance.temperatureRangeC.max)}°C`]);
  if (performance.resolutionPixels?.width && performance.resolutionPixels?.height) rows.push(["רזולוציה", `${performance.resolutionPixels.width}×${performance.resolutionPixels.height}`]);
  if (technical.barcodes.length) rows.push(["ברקוד", technical.barcodes.join(", ")]);
  return rows.filter(([, value]) => value).map(([label, value]) => ({ label, value }));
}

function getMetricValue(product, key) {
  const technical = product.technical;
  const direct = {
    ...technical.dimensionsCm,
    ...technical.capacities,
    ...technical.performance,
    weightKg: technical.weightKg,
    displayWidthCm: divideByTen(technical.displayDimensionsMm.withoutStand.widthMm),
    displayHeightCm: divideByTen(technical.displayDimensionsMm.withoutStand.heightMm),
    displayDepthCm: divideByTen(technical.displayDimensionsMm.withoutStand.depthMm),
  };
  return isFiniteNumber(direct[key]) ? Number(direct[key]) : null;
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = cleanString(getKey(item));
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
}

function createFilterButton(dataName, value, label, pressed) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = dataName === "category" ? "category-filter" : "color-filter";
  button.dataset[dataName] = value;
  button.setAttribute("aria-pressed", String(pressed));
  button.textContent = label;
  return button;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function numericRecord(value, keys) {
  const result = {};
  keys.forEach((key) => {
    if (isFiniteNumber(value?.[key])) result[key] = Number(value[key]);
  });
  return result;
}

function numericRange(value) {
  return isFiniteNumber(value?.min) && isFiniteNumber(value?.max) ? { min: Number(value.min), max: Number(value.max) } : null;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function parseNumber(value) {
  const trimmed = cleanString(value);
  return trimmed && Number.isFinite(Number(trimmed)) ? Number(trimmed) : null;
}

function divideByTen(value) {
  return isFiniteNumber(value) ? Number(value) / 10 : null;
}

function joinParts(parts) {
  return parts.filter(([, value]) => isFiniteNumber(value)).map(([label, value, unit]) => `${label} ${formatNumber(value)}${unit ? ` ${unit}` : ""}`).join(" · ");
}

function normalizeSearch(value) {
  return cleanString(value)
    .toLocaleLowerCase("he-IL")
    .normalize("NFKD")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[״"׳']/g, "")
    .replace(/[^\p{L}\p{N}.+-]+/gu, " ")
    .trim();
}

function cleanString(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatNumber(value) {
  return Number(value).toLocaleString("he-IL", { maximumFractionDigits: 2 });
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

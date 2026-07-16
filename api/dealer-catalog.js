import { get } from "@vercel/blob";
import { readFile } from "node:fs/promises";
import { hasDatabaseStorageCredentials, readDatabaseState } from "./_database.js";
import { STATE_PATH, getBlobAuthOptions, hasBlobStorageCredentials, streamToText } from "./_state-backups.js";

const DEFAULT_ASSET_ORIGIN = "https://price-search-teal.vercel.app";
const MANIFEST_URL = new URL("../public/specs.json", import.meta.url);
const CATALOG_ATTRIBUTES_PATH = "price-search/catalog-attributes.json";
const DEALER_PRIVATE_FIELDS = new Set([
  "price",
  "pricetext",
  "priceincludesvat",
  "listprice",
  "unitprice",
  "pricesource",
  "stock",
  "stockquantity",
  "inventory",
  "quantity",
  "available",
  "availability",
  "instock",
  "outofstock",
  "isavailable",
  "מחיר",
  "מלאי",
  "כמות",
  "זמינות",
  "זמין",
]);
const COLOR_RULES = [
  ["שחור", /שחור|black|\bbk\b/i],
  ["לבן", /לבן|white|\bwh\b/i],
  ["נירוסטה", /נירוסטה|inox|stainless|silver|\bss\b/i],
  ["אפור", /אפור|אפור[ה]?|grey|gray/i],
  ["שמנת", /שמנת|beige|cream/i],
  ["כסוף", /כסוף|chrome/i],
  ["אדום", /אדום|red/i],
];

let manifestPromise = null;

// Public, read-only catalog endpoint. Its response is deliberately whitelisted:
// it never returns price, stock, customer, order or reservation fields.
export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "public, max-age=60, s-maxage=600, stale-while-revalidate=86400");

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const [stored, manifest, attributes] = await Promise.all([readCatalogState(), readSpecManifest(), readCatalogAttributes()]);
    const assetOrigin = getAssetOrigin();
    const products = sanitizeProducts(stored.state?.products, manifest, attributes, assetOrigin);
    assertDealerCatalogPrivacy(products);

    sendJson(response, 200, {
      version: 1,
      source: "read-only-live-catalog",
      updatedAt: stored.updatedAt || stored.state?.updatedAt || null,
      products,
    });
  } catch (error) {
    console.error("dealer_catalog_read_failed", error);
    sendJson(response, 503, { error: "catalog_unavailable" });
  }
}

async function readCatalogAttributes() {
  if (!hasBlobStorageCredentials()) return {};
  const stored = await get(CATALOG_ATTRIBUTES_PATH, { access: "private", useCache: true, ...getBlobAuthOptions() });
  if (!stored || stored.statusCode !== 200 || !stored.stream) return {};
  const catalog = JSON.parse(await streamToText(stored.stream));
  return catalog?.items && typeof catalog.items === "object" ? catalog.items : {};
}

async function readCatalogState() {
  if (hasDatabaseStorageCredentials()) {
    const stored = await readDatabaseState();
    return stored || { state: { products: [] }, updatedAt: null };
  }

  if (!hasBlobStorageCredentials()) return { state: { products: [] }, updatedAt: null };

  const stored = await get(STATE_PATH, { access: "private", useCache: true, ...getBlobAuthOptions() });
  if (!stored || stored.statusCode !== 200 || !stored.stream) return { state: { products: [] }, updatedAt: null };
  const state = JSON.parse(await streamToText(stored.stream));
  return { state, updatedAt: state.updatedAt || null };
}

async function readSpecManifest() {
  if (!manifestPromise) {
    manifestPromise = readFile(MANIFEST_URL, "utf8")
      .then((text) => JSON.parse(text))
      .catch((error) => {
        manifestPromise = null;
        throw error;
      });
  }
  return manifestPromise;
}

function sanitizeProducts(value, manifest, attributesByModel, assetOrigin) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((product) => {
      const model = cleanString(product?.sku);
      const name = cleanString(product?.description);
      if (!model || !name || normalizeKey(model) === "כללי") return null;
      const key = model.toUpperCase();
      if (seen.has(key)) return null;
      seen.add(key);
      const attributes = attributesByModel?.[normalizeKey(model)] || {};
      const technical = sanitizeTechnicalAttributes(attributes, name);
      return {
        model,
        name,
        category: technical.category,
        colors: [...new Set([...inferColors(name), ...technical.colors])],
        technical,
        documents: getDocuments(manifest, model, assetOrigin),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.model.localeCompare(right.model, "en"));
}

function sanitizeTechnicalAttributes(value, name) {
  const attributes = value && typeof value === "object" ? value : {};
  const dimensionsCm = numericRecord(attributes.dimensionsCm, ["widthCm", "heightCm", "depthCm"]);
  const capacities = numericRecord(attributes.capacities, ["totalLiters", "fridgeLiters", "freezerLiters", "ovenLiters", "bottleCount", "placeSettings", "washKg"]);
  const performance = numericRecord(attributes.performance, ["powerW", "programCount", "noiseDb", "waterConsumptionLiters", "spinRpm", "airflowM3h", "screenSizeInches"]);
  const energyRating = cleanEnergyRating(attributes.performance?.energyRating);
  const temperatureRangeC = numericRange(attributes.performance?.temperatureRangeC);
  const resolutionPixels = numericRecord(attributes.performance?.resolutionPixels, ["width", "height"]);
  const displayDimensionsMm = {
    withoutStand: numericRecord(attributes.displayDimensionsMm?.withoutStand, ["widthMm", "heightMm", "depthMm"]),
    withStand: numericRecord(attributes.displayDimensionsMm?.withStand, ["widthMm", "heightMm", "depthMm"]),
  };
  const category = cleanString(attributes.classification?.category) || inferCategory(name);
  const colors = [...new Set((Array.isArray(attributes.colors) ? attributes.colors : []).map(cleanString).filter(Boolean))];
  const barcodes = [...new Set((Array.isArray(attributes.barcodes) ? attributes.barcodes : [])
    .map(cleanString)
    .filter((barcode) => /^\d{10,14}$/.test(barcode)))];
  const facts = [...new Set([
    ...(Array.isArray(attributes.features) ? attributes.features : []),
    ...(Array.isArray(attributes.sourceFacts) ? attributes.sourceFacts : []),
  ].map(cleanTechnicalFact).filter(isDealerSafeFact))].slice(0, 80);
  return {
    category,
    colors,
    dimensionsCm,
    ...(Object.keys(capacities).length ? { capacities } : {}),
    ...(Object.keys(performance).length || energyRating || temperatureRangeC || Object.keys(resolutionPixels).length
      ? { performance: { ...performance, ...(energyRating ? { energyRating } : {}), ...(temperatureRangeC ? { temperatureRangeC } : {}), ...(Object.keys(resolutionPixels).length ? { resolutionPixels } : {}) } }
      : {}),
    ...(Object.keys(displayDimensionsMm.withoutStand).length || Object.keys(displayDimensionsMm.withStand).length ? { displayDimensionsMm } : {}),
    ...(isFiniteNumber(attributes.weightKg) ? { weightKg: Number(attributes.weightKg) } : {}),
    ...(barcodes.length ? { barcodes } : {}),
    facts,
  };
}

// This guard sits after the explicit whitelist above. If a later code change
// accidentally adds a commercial field to the public response, the request
// fails closed instead of exposing price, stock, quantity or availability.
function assertDealerCatalogPrivacy(value, path = "catalog") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDealerCatalogPrivacy(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = cleanString(key).toLocaleLowerCase("en-US");
    if (DEALER_PRIVATE_FIELDS.has(normalizedKey)) {
      throw new Error(`dealer_catalog_private_field:${path}.${key}`);
    }
    assertDealerCatalogPrivacy(item, `${path}.${key}`);
  }
}

function isDealerSafeFact(value) {
  const fact = cleanTechnicalFact(value);
  if (!fact) return false;
  // Technical facts must not turn into an indirect stock or price label.
  return !/(?:מחיר|מלאי|זמינ(?:ות|ים)?|אזל|price|stock|availability|inventory)/i.test(fact);
}

function cleanTechnicalFact(value) {
  const raw = cleanString(value);
  if (
    !raw ||
    /[?？�]/.test(raw) ||
    /(?:https?:\/\/|www\.)/i.test(raw) ||
    /\b(?:unknown|n\/?a|null|undefined)\b/i.test(raw) ||
    /^[\s•|,;:()\-–—.]+$/.test(raw) ||
    /:\s*$/.test(raw) ||
    (raw.includes("•") && (!raw.trim().startsWith("•") || (raw.match(/•/g) || []).length > 1))
  ) return "";

  const fact = raw
    .replace(/\b\d{10,14}\b/g, "")
    .replace(/^[\s•|,;:()\-–—]+/, "")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/[\s|,;·()\-–—]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!fact || fact.length < 3 || isTechnicalHeadingOrLooseValue(fact)) return "";
  if (/(?:\b(?:with|and|or)|עם|של|מול|מערכת|טכנולוגיית|חיבור|הפעלה|כולל|מובנה|לקליטת|לנוחיות|לרשת|לבהירות|מגירת|תאורת|עוצמת|צריכת)$/i.test(fact)) return "";
  return fact;
}

function cleanEnergyRating(value) {
  const rating = cleanString(value).toUpperCase();
  return /^[A-G](?:\+{0,3})$/.test(rating) ? rating : "";
}

function isTechnicalHeadingOrLooseValue(value) {
  return /^(?:(?:FJ|IT)[\s-]*[A-Z0-9-]+|להמחשה|גודל מסך|יחס תצוגה|רזולוציה|מידות(?: ללא מעמד| כולל מעמד)?|משקל|נפח(?: כללי)?|תא מזון|תא הקפאה|תא אפייה|קיבולת|הספק|תוכניות|תכניות|סל[״"]?ד|רמת רעש|צריכת מים|עוצמת יניקה|דירוג אנרגטי|צבע|ברקוד)$/i.test(value)
    || /^\d{1,2}:\d{1,2}$/.test(value)
    || /^\d+(?:\.\d+)?\s*(?:[״"]|ליטר|ק[״"]?ג|w|db|סל[״"]?ד|אינץ[׳']?)$/i.test(value)
    || /^(?:גימור|מאפיינים(?: מיוחדים)?|מערכות|דגם(?: ברקוד)?|מבנה(?: תא(?: הקירור| ההקפאה)?| מיוחד)?|נפח תא(?: המזון| ההקפאה| האפייה)?|אביזרים(?: נלווים)?|תכונות|מנגנונים(?: מיוחדים)?|מיוחדים|מולטימדיה|כניסות|לחצנים וכפתורים|סוגי התוכניות|תיאור כללי|פונקציות|כיריים|תאים|מנוע|מבנה|מיוחד|גוף|אוטומטי|עוצמה|הקירור|ההקפאה|התמונה|הדחה|הספק(?: מנוע|י המבערים| מקסימלי)?|קיבולת כביסה|מהירות סחיטה|מצב כיבוי תאורה|צג וכפתורים|מגירות ומידוף|טכנולוגיית קירור|נפח תא|מקסימלית|תאורה|התקנה|שחור|לבן|שמנת|נירוסטה|כסוף|אפור|אדום|כחול|ירוק|זכוכית(?: שחורה| לבנה)?|שחורה|לבנה)$/i.test(value)
    || /^(?:לסאונד|לעיצוב|לבטיחות|של הקור|בתוך|ופונקציות|ומידוף|וקערות|המאפשר|הכולל|המפסיקים|מקררת את|לא יפעלו|באמצעות|לאחר סיום|ממצב|צורכים|עומד בקו|זמזם|פתיחה צד|תמונה גבוהים|גבוהים במיוחד|המשתמש|לפקודות|מנגנון נעילת|שווה ואחידה)/i.test(value);
}

function numericRecord(value, keys) {
  const result = {};
  for (const key of keys) {
    if (isFiniteNumber(value?.[key])) result[key] = Number(value[key]);
  }
  return result;
}

function numericRange(value) {
  if (!isFiniteNumber(value?.min) || !isFiniteNumber(value?.max)) return null;
  return { min: Number(value.min), max: Number(value.max) };
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function inferCategory(name) {
  const categories = [
    ["טלוויזיה", ["TV", "טלוויז"]],
    ["מיקרוגל", ["מיקרוגל"]],
    ["תנור", ["תנור"]],
    ["קולט אדים", ["קולט"]],
    ["כיריים", ["כיריים"]],
    ["מדיח כלים", ["מדיח"]],
    ["מכונת כביסה", ["מכונת כביסה", "מ.כביסה"]],
    ["מייבש כביסה", ["מייבש"]],
    ["מקרר", ["מקרר"]],
    ["מקפיא", ["מקפיא"]],
  ];
  const lowered = cleanString(name).toLocaleLowerCase("he-IL");
  return categories.find(([, terms]) => terms.some((term) => lowered.includes(term.toLocaleLowerCase("he-IL"))))?.[0] || "אחר";
}

function getDocuments(manifest, model, assetOrigin) {
  const skuKey = cleanString(model).toUpperCase();
  const modelKey = normalizeKey(model);
  const item = manifest?.items?.[skuKey] || manifest?.lookup?.[modelKey] || null;
  const files = Array.isArray(item?.files) ? item.files : item?.url ? [item] : [];
  return files
    .map((file) => {
      const url = cleanString(file?.url);
      if (!url) return null;
      return {
        label: file.installation ? "הוראות התקנה" : "מפרט PDF",
        type: file.installation ? "installation" : "specification",
        url: new URL(url, assetOrigin).toString(),
      };
    })
    .filter(Boolean);
}

function inferColors(value) {
  return COLOR_RULES.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
}

function getAssetOrigin() {
  const candidate = cleanString(process.env.CATALOG_ASSET_ORIGIN || DEFAULT_ASSET_ORIGIN).replace(/\/+$/, "");
  try {
    return new URL(candidate).origin;
  } catch {
    return DEFAULT_ASSET_ORIGIN;
  }
}

function normalizeKey(value) {
  return cleanString(value).toLocaleUpperCase("en-US").replace(/[^A-Z0-9א-ת]/g, "");
}

function cleanString(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sendJson(response, statusCode, data) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

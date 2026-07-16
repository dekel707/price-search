import { get } from "@vercel/blob";
import { readFile } from "node:fs/promises";
import { hasDatabaseStorageCredentials, readDatabaseState } from "./_database.js";
import { STATE_PATH, getBlobAuthOptions, hasBlobStorageCredentials, streamToText } from "./_state-backups.js";

const DEFAULT_ASSET_ORIGIN = "https://price-search-teal.vercel.app";
const MANIFEST_URL = new URL("../public/specs.json", import.meta.url);
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
    const [stored, manifest] = await Promise.all([readCatalogState(), readSpecManifest()]);
    const assetOrigin = getAssetOrigin();
    const products = sanitizeProducts(stored.state?.products, manifest, assetOrigin);

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

function sanitizeProducts(value, manifest, assetOrigin) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((product) => {
      const model = cleanString(product?.sku);
      const name = cleanString(product?.description);
      if (!model || !name || normalizeKey(model) === "כללי") return null;
      const key = model.toUpperCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        model,
        name,
        colors: inferColors(name),
        documents: getDocuments(manifest, model, assetOrigin),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.model.localeCompare(right.model, "en"));
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

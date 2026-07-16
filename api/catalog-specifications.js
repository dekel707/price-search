import { get, put } from "@vercel/blob";
import { isAuthorized } from "./_auth.js";
import {
  getCatalogSpecificationStatus,
  hasDatabaseStorageCredentials,
  readCatalogSpecifications,
  readCatalogSpecificationSummaries as readDatabaseCatalogSpecificationSummaries,
  saveCatalogSpecifications,
} from "./_database.js";
import { getBlobAuthOptions, hasBlobStorageCredentials, streamToText } from "./_state-backups.js";

const CATALOG_BLOB_PATH = "price-search/catalog-attributes.json";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "2mb",
    },
  },
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }
  if (!hasDatabaseStorageCredentials() && !hasBlobStorageCredentials()) {
    sendJson(response, 503, { error: "catalog_storage_not_configured" });
    return;
  }

  try {
    if (request.method === "GET") {
      const catalog = await readStoredCatalogSpecifications();
      sendJson(response, 200, { ok: true, ...catalog });
      return;
    }
    if (request.method === "POST") {
      const catalog = normalizeCatalog(request.body);
      const saved = await saveStoredCatalogSpecifications(catalog);
      sendJson(response, 200, { ok: true, ...saved });
      return;
    }
    sendJson(response, 405, { error: "method_not_allowed" });
  } catch (error) {
    console.error("catalog_specifications_failed", error);
    sendJson(response, 500, { error: "catalog_specifications_failed" });
  }
}

export async function readCatalogSpecificationSummaries() {
  if (hasDatabaseStorageCredentials()) {
    return readDatabaseCatalogSpecificationSummaries();
  }
  const catalog = await readBlobCatalog();
  return new Map(
    Object.entries(catalog.items || {}).map(([skuKey, attributes]) => [skuKey, String(attributes?.searchSummary || "")]),
  );
}

async function readStoredCatalogSpecifications() {
  if (hasDatabaseStorageCredentials()) {
    const [items, status] = await Promise.all([readCatalogSpecifications(), getCatalogSpecificationStatus()]);
    return { storage: "database", ...status, items };
  }
  const catalog = await readBlobCatalog();
  const items = catalog.items || {};
  return {
    storage: "blob",
    count: Object.keys(items).length,
    updatedAt: catalog.generatedAt || null,
    items,
  };
}

async function saveStoredCatalogSpecifications(catalog) {
  if (hasDatabaseStorageCredentials()) {
    const saved = await saveCatalogSpecifications(catalog);
    return { storage: "database", ...saved, ...(await getCatalogSpecificationStatus()) };
  }
  const blob = await put(CATALOG_BLOB_PATH, JSON.stringify(catalog), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
    ...getBlobAuthOptions(),
  });
  return {
    storage: "blob",
    count: Object.keys(catalog.items).length,
    updatedAt: catalog.generatedAt || new Date().toISOString(),
    pathname: blob.pathname,
  };
}

async function readBlobCatalog() {
  const stored = await get(CATALOG_BLOB_PATH, {
    access: "private",
    useCache: false,
    ...getBlobAuthOptions(),
  });
  if (!stored || stored.statusCode !== 200 || !stored.stream) return { items: {} };
  const value = JSON.parse(await streamToText(stored.stream));
  return value && typeof value === "object" ? value : { items: {} };
}

function normalizeCatalog(value) {
  const items = value?.items;
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    const error = new Error("invalid_catalog");
    error.code = "invalid_catalog";
    throw error;
  }
  const normalized = {};
  for (const [skuKey, attributes] of Object.entries(items)) {
    if (!/^[A-Z0-9]+$/.test(skuKey) || !attributes || typeof attributes !== "object" || Array.isArray(attributes)) continue;
    const model = String(attributes?.identity?.model || "").trim();
    const searchText = String(attributes?.searchText || "").trim();
    if (!model || !searchText) continue;
    // JSON round-trip prevents unexpected prototypes and keeps the database
    // payload to portable JSON data only.
    normalized[skuKey] = JSON.parse(JSON.stringify(attributes));
  }
  if (Object.keys(normalized).length < 100) {
    const error = new Error("catalog_too_small");
    error.code = "catalog_too_small";
    throw error;
  }
  return { schemaVersion: Number(value?.schemaVersion) || 1, generatedAt: String(value?.generatedAt || ""), items: normalized };
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

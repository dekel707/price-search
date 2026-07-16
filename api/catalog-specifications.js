import { isAuthorized } from "./_auth.js";
import {
  getCatalogSpecificationStatus,
  hasDatabaseStorageCredentials,
  readCatalogSpecifications,
  saveCatalogSpecifications,
} from "./_database.js";

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
  if (!hasDatabaseStorageCredentials()) {
    sendJson(response, 503, { error: "database_not_configured" });
    return;
  }

  try {
    if (request.method === "GET") {
      const [items, status] = await Promise.all([readCatalogSpecifications(), getCatalogSpecificationStatus()]);
      sendJson(response, 200, { ok: true, ...status, items });
      return;
    }
    if (request.method === "POST") {
      const catalog = normalizeCatalog(request.body);
      const saved = await saveCatalogSpecifications(catalog);
      sendJson(response, 200, { ok: true, ...saved, ...(await getCatalogSpecificationStatus()) });
      return;
    }
    sendJson(response, 405, { error: "method_not_allowed" });
  } catch (error) {
    console.error("catalog_specifications_failed", error);
    sendJson(response, 500, { error: "catalog_specifications_failed" });
  }
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

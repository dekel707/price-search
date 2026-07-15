import { get, put } from "@vercel/blob";
import { isAuthorized } from "./_auth.js";
import {
  STATE_PATH,
  createStateBackup,
  getBlobAuthOptions,
  hasBlobStorageCredentials,
  streamToText,
} from "./_state-backups.js";

const EMPTY_STATE = {
  version: 5,
  products: [],
  meta: null,
  categories: [],
  customers: [],
  annotations: {},
  orders: [],
  drafts: [],
  lastPrices: {},
  reservations: [],
  reservationSeedVersion: 0,
  reminders: [],
  collections: [],
  settings: { whatsappNumber: "" },
  updatedAt: null,
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
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

  if (!hasBlobStorageCredentials()) {
    sendJson(response, 503, { error: "cloud_storage_not_configured" });
    return;
  }

  try {
    if (request.method === "GET") {
      const stored = await get(STATE_PATH, { access: "private", useCache: false, ...getBlobAuthOptions() });
      if (!stored || stored.statusCode !== 200 || !stored.stream) {
        sendJson(response, 200, EMPTY_STATE);
        return;
      }

      const text = await streamToText(stored.stream);
      sendJson(response, 200, normalizeState(JSON.parse(text)));
      return;
    }

    if (request.method === "POST") {
      const payload = normalizeState(await readJsonBody(request));
      payload.updatedAt = new Date().toISOString();
      const blobAuthOptions = getBlobAuthOptions();

      // A save is never allowed to replace the live state before its own private,
      // immutable snapshot exists. This keeps every successful change recoverable.
      const backup = await createStateBackup(payload, {
        reason: "state-save",
        blobAuthOptions,
      });

      await put(STATE_PATH, JSON.stringify(payload), {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json; charset=utf-8",
        cacheControlMaxAge: 60,
        ...blobAuthOptions,
      });

      sendJson(response, 200, { ok: true, updatedAt: payload.updatedAt, backup });
      return;
    }

    sendJson(response, 405, { error: "method_not_allowed" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "state_sync_failed" });
  }
}

function normalizeState(value) {
  const state = value && typeof value === "object" ? value : {};

  return {
    ...EMPTY_STATE,
    ...state,
    version: 5,
    products: Array.isArray(state.products) ? state.products : [],
    meta: state.meta && typeof state.meta === "object" ? state.meta : null,
    categories: Array.isArray(state.categories) ? state.categories : [],
    customers: Array.isArray(state.customers) ? state.customers : [],
    annotations: state.annotations && typeof state.annotations === "object" ? state.annotations : {},
    orders: Array.isArray(state.orders) ? state.orders : [],
    drafts: Array.isArray(state.drafts) ? state.drafts : [],
    lastPrices: state.lastPrices && typeof state.lastPrices === "object" ? state.lastPrices : {},
    reservations: Array.isArray(state.reservations) ? state.reservations : [],
    reservationSeedVersion: Number.isFinite(Number(state.reservationSeedVersion))
      ? Math.max(0, Math.floor(Number(state.reservationSeedVersion)))
      : 0,
    reminders: Array.isArray(state.reminders) ? state.reminders : [],
    collections: Array.isArray(state.collections) ? state.collections : [],
    settings: {
      ...EMPTY_STATE.settings,
      ...(state.settings && typeof state.settings === "object" ? state.settings : {}),
    },
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : null,
  };
}

async function readJsonBody(request) {
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString("utf8") || "{}");
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  if (request.body && typeof request.body === "object") return request.body;

  const body = await new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });

  return JSON.parse(body || "{}");
}

function sendJson(response, statusCode, data) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

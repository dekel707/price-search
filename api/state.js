import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { isAuthorized } from "./_auth.js";
import { mergeRecentMissingOrders } from "./_order-conflict-recovery.js";
import {
  hasDatabaseStorageCredentials,
  initializeDatabaseState,
  readDatabaseState,
  saveDatabaseState,
} from "./_database.js";
import {
  STATE_PATH,
  createStateBackup,
  ensureDailyStateBackup,
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
  orderTombstones: [],
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
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-State-Version, X-State-Action");
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

  const databaseConfigured = hasDatabaseStorageCredentials();
  if (!databaseConfigured && !hasBlobStorageCredentials()) {
    sendJson(response, 503, { error: "cloud_storage_not_configured" });
    return;
  }

  try {
    if (request.method === "GET") {
      if (databaseConfigured) {
        const stored = await readOrMigrateDatabaseState();
        response.setHeader("X-State-Version", stored.version);
        sendJson(response, 200, normalizeState(stored.state));
        return;
      }

      const stored = await get(STATE_PATH, { access: "private", useCache: false, ...getBlobAuthOptions() });
      if (!stored || stored.statusCode !== 200 || !stored.stream) {
        response.setHeader("X-State-Version", "");
        sendJson(response, 200, EMPTY_STATE);
        return;
      }

      const text = await streamToText(stored.stream);
      response.setHeader("X-State-Version", getStoredStateVersion(stored));
      sendJson(response, 200, normalizeState(JSON.parse(text)));
      return;
    }

    if (request.method === "POST") {
      const payload = normalizeState(await readJsonBody(request));
      payload.updatedAt = new Date().toISOString();
      const expectedVersion = getRequestHeader(request, "x-state-version");
      const action = getSafeActionName(getRequestHeader(request, "x-state-action"));

      if (databaseConfigured) {
        const currentDatabaseState = await readOrMigrateDatabaseState();
        let dailyBackup = null;
        if (hasBlobStorageCredentials()) {
          try {
            dailyBackup = await ensureDailyStateBackup(currentDatabaseState.state, {
              blobAuthOptions: getBlobAuthOptions(),
            });
          } catch (error) {
            // A database save remains safe even when the secondary archive is
            // temporarily unavailable; database history still records both versions.
            console.error("daily_blob_backup_failed", error);
          }
        }
        const saved = await saveDatabaseState(payload, expectedVersion, { action });
        if (saved.missing) {
          throw new Error("database_state_initialization_failed");
        }

        if (saved.alreadyCurrent) {
          response.setHeader("X-State-Version", saved.current.version);
          sendJson(response, 200, {
            ok: true,
            alreadyCurrent: true,
            updatedAt: saved.current.updatedAt,
            stateVersion: saved.current.version,
            dailyBackup,
          });
          return;
        }

        if (saved.recovered) {
          response.setHeader("X-State-Version", saved.current.version);
          sendJson(response, 200, {
            ok: true,
            updatedAt: saved.current.updatedAt,
            stateVersion: saved.current.version,
            backup: saved.backup,
            previousBackup: saved.previousBackup,
            dailyBackup,
            recoveredConflict: summarizeRecoveredConflict(saved.addedOrders, saved.reservationAdjustments, saved.addedCustomers),
          });
          return;
        }

        if (saved.conflict) {
          response.setHeader("X-State-Version", saved.current.version);
          sendJson(response, 409, {
            error: "state_conflict",
            message: "The live data changed on another device. Your attempted changes were saved as a recovery backup.",
            backup: saved.backup,
          });
          return;
        }

        response.setHeader("X-State-Version", saved.current.version);
        sendJson(response, 200, {
          ok: true,
          updatedAt: payload.updatedAt,
          stateVersion: saved.current.version,
          backup: saved.backup,
          previousBackup: saved.previousBackup,
          dailyBackup,
        });
        return;
      }

      const blobAuthOptions = getBlobAuthOptions();
      const currentStored = await get(STATE_PATH, {
        access: "private",
        useCache: false,
        ...blobAuthOptions,
      });
      const currentState = currentStored && currentStored.statusCode === 200 ? currentStored : null;
      const currentStateVersion = getStoredStateVersion(currentState);
      const currentStateMatchVersion = toIfMatchVersion(currentStateVersion);
      let currentPayload = null;
      if (currentState) {
        if (!currentStored.stream) {
          throw new Error("live_state_backup_unavailable");
        }
        currentPayload = normalizeState(JSON.parse(await streamToText(currentStored.stream)));
      }

      // If another device saved after this tab was loaded, preserve this tab's
      // attempted state as an immutable recovery copy instead of silently
      // replacing newer live data. New, recent orders are additionally merged
      // as append-only records, so an older open tab cannot make an order
      // disappear merely because another device saved first.
      if (currentState && expectedVersion !== currentStateVersion) {
        if (statesMatchIgnoringSaveMetadata(currentPayload, payload)) {
          response.setHeader("X-State-Version", currentStateVersion);
          sendJson(response, 200, {
            ok: true,
            alreadyCurrent: true,
            updatedAt: currentPayload.updatedAt,
            stateVersion: currentStateVersion,
          });
          return;
        }
        const backup = await createStateBackup(payload, {
          reason: `conflict-${action}`,
          blobAuthOptions,
        });
        const recovery = mergeRecentMissingOrders(currentPayload, payload);
        if (recovery.recovered) {
          const previousBackup = await createStateBackup(currentPayload, {
            reason: `before-conflict-${action}`,
            blobAuthOptions,
          });
          const recoveryBackup = await createStateBackup(recovery.state, {
            reason: `recovered-${action}`,
            blobAuthOptions,
          });
          try {
            const saved = await put(STATE_PATH, JSON.stringify(recovery.state), {
              access: "private",
              allowOverwrite: true,
              contentType: "application/json; charset=utf-8",
              cacheControlMaxAge: 60,
              ...(currentStateMatchVersion ? { ifMatch: currentStateMatchVersion } : {}),
              ...blobAuthOptions,
            });
            response.setHeader("X-State-Version", saved.etag || "");
            sendJson(response, 200, {
              ok: true,
              updatedAt: recovery.state.updatedAt,
              stateVersion: saved.etag || "",
              backup: recoveryBackup,
              previousBackup,
              conflictBackup: backup,
              recoveredConflict: summarizeRecoveredConflict(recovery.addedOrders, recovery.reservationAdjustments, recovery.addedCustomers),
            });
            return;
          } catch (error) {
            if (error instanceof BlobPreconditionFailedError) {
              response.setHeader("X-State-Version", "");
              sendJson(response, 409, {
                error: "state_conflict",
                message: "The live data changed while recovery was running. Your attempted changes were saved as a recovery backup.",
                backup,
              });
              return;
            }
            throw error;
          }
        }
        response.setHeader("X-State-Version", currentStateVersion);
        sendJson(response, 409, {
          error: "state_conflict",
          message: "The live data changed on another device. Your attempted changes were saved as a recovery backup.",
          backup,
        });
        return;
      }

      // Preserve both sides of every change. The current live version is saved
      // first, then the incoming version is saved before it replaces live data.
      // A malformed or incomplete payload can therefore never erase the last
      // known-good data without leaving a complete recovery point.
      let previousBackup = null;
      let dailyBackup = null;
      if (currentState) {
        dailyBackup = await ensureDailyStateBackup(currentPayload, { blobAuthOptions });
        previousBackup = await createStateBackup(currentPayload, {
          reason: `before-${action}`,
          blobAuthOptions,
        });
      }

      const backup = await createStateBackup(payload, {
        reason: `after-${action}`,
        blobAuthOptions,
      });

      let saved;
      try {
        saved = await put(STATE_PATH, JSON.stringify(payload), {
          access: "private",
          allowOverwrite: true,
          contentType: "application/json; charset=utf-8",
          cacheControlMaxAge: 60,
          ...(currentStateMatchVersion ? { ifMatch: currentStateMatchVersion } : {}),
          ...blobAuthOptions,
        });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) {
          response.setHeader("X-State-Version", "");
          sendJson(response, 409, {
            error: "state_conflict",
            message: "The live data changed while this save was running. Your attempted changes were saved as a recovery backup.",
            backup,
          });
          return;
        }
        throw error;
      }

      response.setHeader("X-State-Version", saved.etag || "");
      sendJson(response, 200, {
        ok: true,
        updatedAt: payload.updatedAt,
        stateVersion: saved.etag || "",
        backup,
        previousBackup,
        dailyBackup,
      });
      return;
    }

    sendJson(response, 405, { error: "method_not_allowed" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "state_sync_failed" });
  }
}

function getRequestHeader(request, name) {
  const value = request.headers?.[name] || request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function getSafeActionName(value) {
  return String(value || "state-change")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "state-change";
}

function getStoredStateVersion(stored) {
  return stored?.statusCode === 200 ? stored.blob?.etag || "" : "";
}

function toIfMatchVersion(version) {
  // Blob reads can return a weak ETag (W/\"…\"). Conditional writes require
  // the corresponding strong validator, while the original value remains the
  // version shared with the browser for conflict detection.
  return version.startsWith("W/") ? version.slice(2) : version;
}

function summarizeRecoveredConflict(orders, reservationAdjustments, customers = []) {
  return {
    orderCount: Array.isArray(orders) ? orders.length : 0,
    orderIds: Array.isArray(orders) ? orders.map((order) => String(order?.id || "")).filter(Boolean) : [],
    reservationAdjustmentCount: Array.isArray(reservationAdjustments) ? reservationAdjustments.length : 0,
    customerCount: Array.isArray(customers) ? customers.length : 0,
  };
}

async function readOrMigrateDatabaseState() {
  const stored = await readDatabaseState();
  if (stored) return stored;

  let initialState = EMPTY_STATE;
  if (hasBlobStorageCredentials()) {
    const blob = await get(STATE_PATH, {
      access: "private",
      useCache: false,
      ...getBlobAuthOptions(),
    });
    if (blob?.statusCode === 200 && blob.stream) {
      initialState = normalizeState(JSON.parse(await streamToText(blob.stream)));
    }
  }

  return initializeDatabaseState(initialState);
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
    orderTombstones: normalizeOrderTombstones(state.orderTombstones),
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

function normalizeOrderTombstones(value) {
  const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({ id: String(entry?.id || "").trim(), deletedAt: String(entry?.deletedAt || "") }))
    .filter((entry) => {
      const timestamp = new Date(entry.deletedAt).getTime();
      if (!entry.id || !Number.isFinite(timestamp) || timestamp < cutoff || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
}

function statesMatchIgnoringSaveMetadata(left, right) {
  return JSON.stringify(withoutSaveMetadata(left)) === JSON.stringify(withoutSaveMetadata(right));
}

function withoutSaveMetadata(state) {
  const copy = structuredClone(state && typeof state === "object" ? state : {});
  delete copy.updatedAt;
  delete copy.version;
  return copy;
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

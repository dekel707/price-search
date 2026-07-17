import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { hasDatabaseStorageCredentials, readDatabaseState, saveDatabaseState } from "./_database.js";
import {
  STATE_PATH,
  createStateBackup,
  ensureDailyStateBackup,
  getBlobAuthOptions,
  hasBlobStorageCredentials,
  streamToText,
} from "./_state-backups.js";

export async function readPartnerMainState() {
  if (hasDatabaseStorageCredentials()) {
    const current = await readDatabaseState();
    if (!current?.state) throw stateError("main_state_unavailable", 503);
    return { storage: "database", state: current.state, version: current.version, updatedAt: current.updatedAt };
  }
  if (!hasBlobStorageCredentials()) throw stateError("main_storage_not_configured", 503);
  const blobAuthOptions = getBlobAuthOptions();
  const stored = await get(STATE_PATH, { access: "private", useCache: false, ...blobAuthOptions });
  if (!stored?.stream || stored.statusCode !== 200) throw stateError("main_state_unavailable", 503);
  const state = JSON.parse(await streamToText(stored.stream));
  return {
    storage: "blob",
    state,
    version: stored.blob?.etag || "",
    updatedAt: String(state.updatedAt || ""),
  };
}

export async function savePartnerMainState(current, nextState, { action }) {
  if (current.storage === "database") {
    const saved = await saveDatabaseState(nextState, current.version, { action });
    if (saved.conflict || saved.missing || saved.blockedOrderRemovals) throw stateError("main_state_changed_retry_approval", 409);
    return { ...saved, storage: "database" };
  }

  const blobAuthOptions = getBlobAuthOptions();
  const match = strongEtag(current.version);
  const dailyBackup = await ensureDailyStateBackup(current.state, { blobAuthOptions });
  const previousBackup = await createStateBackup(current.state, { reason: `before-${action}`, blobAuthOptions });
  const backup = await createStateBackup(nextState, { reason: `after-${action}`, blobAuthOptions });
  try {
    const saved = await put(STATE_PATH, JSON.stringify(nextState), {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60,
      ...(match ? { ifMatch: match } : {}),
      ...blobAuthOptions,
    });
    return { ok: true, storage: "blob", stateVersion: saved.etag || "", backup, previousBackup, dailyBackup };
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) throw stateError("main_state_changed_retry_approval", 409);
    throw error;
  }
}

function strongEtag(version) { return String(version || "").startsWith("W/") ? String(version).slice(2) : String(version || ""); }
function stateError(message, statusCode) { const error = new Error(message); error.statusCode = statusCode; return error; }

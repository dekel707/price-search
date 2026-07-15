import crypto from "node:crypto";
import { get } from "@vercel/blob";
import {
  createDatabaseBackup,
  hasDatabaseStorageCredentials,
  initializeDatabaseState,
  readDatabaseState,
} from "./_database.js";
import {
  STATE_PATH,
  createDailyStateBackup,
  getBlobAuthOptions,
  hasBlobStorageCredentials,
  streamToText,
} from "./_state-backups.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");

  if (!isAuthorizedCron(request)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  try {
    const databaseConfigured = hasDatabaseStorageCredentials();
    const blobConfigured = hasBlobStorageCredentials();
    if (!databaseConfigured && !blobConfigured) {
      sendJson(response, 503, { error: "cloud_storage_not_configured" });
      return;
    }

    const state = databaseConfigured
      ? await readOrMigrateDatabaseState(blobConfigured)
      : await readBlobState();

    const databaseBackup = databaseConfigured
      ? await createDatabaseBackup(state, { reason: "daily-scheduled" })
      : null;
    const blobBackup = blobConfigured
      ? await createDailyStateBackup(state, { blobAuthOptions: getBlobAuthOptions() })
      : null;

    sendJson(response, 200, {
      ok: true,
      databaseBackup,
      blobBackup,
    });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "daily_backup_failed" });
  }
}

async function readOrMigrateDatabaseState(blobConfigured) {
  const current = await readDatabaseState();
  if (current) return current.state;

  const initialState = blobConfigured ? await readBlobState() : {};
  const initialized = await initializeDatabaseState(initialState);
  return initialized.state;
}

async function readBlobState() {
  const stored = await get(STATE_PATH, {
    access: "private",
    useCache: false,
    ...getBlobAuthOptions(),
  });
  if (!stored || stored.statusCode !== 200 || !stored.stream) {
    throw new Error("state_not_found");
  }
  return JSON.parse(await streamToText(stored.stream));
}

function isAuthorizedCron(request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const authorization = String(request.headers?.authorization || "");
  const expected = `Bearer ${secret}`;
  if (!secret || authorization.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

function sendJson(response, statusCode, data) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

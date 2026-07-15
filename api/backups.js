import { get, list } from "@vercel/blob";
import { isAuthorized } from "./_auth.js";
import {
  BACKUPS_PREFIX,
  STATE_PATH,
  createStateBackup,
  getBlobAuthOptions,
  hasBlobStorageCredentials,
  streamToText,
} from "./_state-backups.js";

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
    const blobAuthOptions = getBlobAuthOptions();

    if (request.method === "GET") {
      const result = await list({ prefix: BACKUPS_PREFIX, limit: 30, ...blobAuthOptions });
      const backups = (result.blobs || []).map(({ pathname, uploadedAt, size }) => ({
        pathname,
        uploadedAt,
        size,
      }));

      sendJson(response, 200, { backups, hasMore: Boolean(result.hasMore) });
      return;
    }

    if (request.method === "POST") {
      const stored = await get(STATE_PATH, {
        access: "private",
        useCache: false,
        ...blobAuthOptions,
      });

      if (!stored || stored.statusCode !== 200 || !stored.stream) {
        sendJson(response, 404, { error: "state_not_found" });
        return;
      }

      const state = JSON.parse(await streamToText(stored.stream));
      const backup = await createStateBackup(state, {
        reason: "manual",
        blobAuthOptions,
      });

      sendJson(response, 200, { ok: true, backup });
      return;
    }

    sendJson(response, 405, { error: "method_not_allowed" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "backup_failed" });
  }
}

function sendJson(response, statusCode, data) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

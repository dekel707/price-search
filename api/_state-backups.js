import { list, put } from "@vercel/blob";

export const STATE_PATH = "price-search/state.json";
export const BACKUPS_PREFIX = "price-search/backups/";
export const DAILY_BACKUPS_PREFIX = "price-search/daily-backups/";

export function getBlobAuthOptions() {
  const token = getEnvValue("BLOB_READ_WRITE_TOKEN");
  if (token) return { token };

  const oidcToken = getEnvValue("VERCEL_OIDC_TOKEN");
  return oidcToken ? { oidcToken } : {};
}

export function hasBlobStorageCredentials() {
  return Boolean(getEnvValue("BLOB_READ_WRITE_TOKEN") || getEnvValue("VERCEL_OIDC_TOKEN"));
}

export async function createStateBackup(state, { reason = "state-save", blobAuthOptions = {} } = {}) {
  const capturedAt = new Date().toISOString();
  const safeReason = String(reason)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "state-save";
  const datePart = capturedAt.slice(0, 10);
  const timePart = capturedAt.replace(/[:.]/g, "-");
  const pathname = `${BACKUPS_PREFIX}${datePart}/${timePart}-${safeReason}.json`;

  const blob = await put(
    pathname,
    JSON.stringify({
      backupVersion: 1,
      capturedAt,
      reason: safeReason,
      state,
    }),
    {
      access: "private",
      addRandomSuffix: true,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60,
      ...blobAuthOptions,
    },
  );

  return {
    pathname: blob.pathname,
    capturedAt,
    size: blob.size,
  };
}

export async function createDailyStateBackup(state, { blobAuthOptions = {} } = {}) {
  const capturedAt = new Date();
  const israelDate = getIsraelDatePart(capturedAt);
  const timePart = capturedAt.toISOString().replace(/[:.]/g, "-");
  const pathname = `${DAILY_BACKUPS_PREFIX}${israelDate}/${timePart}-daily-scheduled.json`;

  const blob = await put(
    pathname,
    JSON.stringify({
      backupVersion: 1,
      capturedAt: capturedAt.toISOString(),
      reason: "daily-scheduled",
      state,
    }),
    {
      access: "private",
      addRandomSuffix: true,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60,
      ...blobAuthOptions,
    },
  );

  return {
    pathname: blob.pathname,
    capturedAt: capturedAt.toISOString(),
    size: blob.size,
    storage: "blob",
  };
}

export async function ensureDailyStateBackup(state, { blobAuthOptions = {} } = {}) {
  const israelDate = getIsraelDatePart(new Date());
  const prefix = `${DAILY_BACKUPS_PREFIX}${israelDate}/`;
  const existing = await list({ prefix, limit: 1, ...blobAuthOptions });
  const snapshot = existing.blobs?.[0];
  if (snapshot) {
    return {
      pathname: snapshot.pathname,
      capturedAt: new Date(snapshot.uploadedAt).toISOString(),
      size: snapshot.size,
      storage: "blob",
      alreadyExists: true,
    };
  }

  return createDailyStateBackup(state, { blobAuthOptions });
}

export async function streamToText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function getEnvValue(name) {
  return String(process.env[name] || "").replace(/^["']|["']$/g, "");
}

function getIsraelDatePart(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

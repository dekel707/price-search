import { put } from "@vercel/blob";

export const STATE_PATH = "price-search/state.json";
export const BACKUPS_PREFIX = "price-search/backups/";

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

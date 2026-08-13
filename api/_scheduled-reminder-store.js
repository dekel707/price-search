import { BlobPreconditionFailedError, get, list, put } from "@vercel/blob";
import {
  cancelScheduledEmailReminder as cancelDatabaseReminder,
  createScheduledEmailReminder as createDatabaseReminder,
  getScheduledEmailReminder as getDatabaseReminder,
  hasDatabaseStorageCredentials,
  listScheduledEmailReminders as listDatabaseReminders,
  updateScheduledEmailReminderDelivery as updateDatabaseReminder,
} from "./_database.js";
import { getBlobAuthOptions, hasBlobStorageCredentials, streamToText } from "./_state-backups.js";

// Operational reminders have their own prefix and their own immutable event
// history. They intentionally never share the state.json document that holds
// orders, customers, reservations, stock and reports.
const REMINDER_PREFIX = "price-search/scheduled-reminders/";
const MAX_EVENT_HISTORY = 50;

export function hasScheduledReminderStorage() {
  return hasBlobStorageCredentials() || hasDatabaseStorageCredentials();
}

export async function listScheduledEmailReminders(limit = 120) {
  if (!hasBlobStorageCredentials()) return listDatabaseReminders(limit);
  const safeLimit = Math.max(1, Math.min(300, Number.parseInt(limit, 10) || 120));
  const listing = await list({ prefix: REMINDER_PREFIX, limit: safeLimit, ...getBlobAuthOptions() });
  const records = await Promise.all((listing.blobs || []).map(async (blob) => {
    const stored = await readBlobReminder(blob.pathname);
    return stored?.reminder || null;
  }));
  return records
    .filter(Boolean)
    .sort((left, right) => String(right.dueAt).localeCompare(String(left.dueAt)))
    .slice(0, safeLimit);
}

export async function getScheduledEmailReminder(id) {
  if (!hasBlobStorageCredentials()) return getDatabaseReminder(id);
  return (await readBlobReminder(reminderPath(id)))?.reminder || null;
}

export async function createScheduledEmailReminder(reminder) {
  if (!hasBlobStorageCredentials()) return createDatabaseReminder(reminder);
  const pathname = reminderPath(reminder.id);
  const current = await readBlobReminder(pathname);
  if (current?.reminder) return { reminder: current.reminder, alreadyExists: true };

  const now = new Date().toISOString();
  const created = normalizeReminder({
    ...reminder,
    id: String(reminder.id || ""),
    createdAt: now,
    updatedAt: now,
    cancelledAt: "",
    events: [createEvent(reminder.eventType || reminder.status || "scheduled", reminder, now)],
  });
  await put(pathname, JSON.stringify(created), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
    ...getBlobAuthOptions(),
  });
  return { reminder: created, alreadyExists: false };
}

export async function updateScheduledEmailReminderDelivery(id, update) {
  if (!hasBlobStorageCredentials()) return updateDatabaseReminder(id, update);
  return updateBlobReminder(id, (current, now) => ({
    ...current,
    status: String(update.status || "scheduled"),
    providerId: String(update.providerId || ""),
    providerStatus: String(update.providerStatus || ""),
    lastError: String(update.lastError || ""),
    updatedAt: now,
    events: appendEvent(current.events, createEvent(update.status || "scheduled", update, now)),
  }));
}

export async function cancelScheduledEmailReminder(id) {
  if (!hasBlobStorageCredentials()) return cancelDatabaseReminder(id);
  const existing = await getScheduledEmailReminder(id);
  if (!existing) return { missing: true, reminder: null };
  if (existing.status === "cancelled") return { missing: false, alreadyCancelled: true, reminder: existing };
  const reminder = await updateBlobReminder(id, (current, now) => ({
    ...current,
    status: "cancelled",
    providerStatus: "cancelled",
    cancelledAt: now,
    updatedAt: now,
    events: appendEvent(current.events, createEvent("cancelled", { providerId: current.providerId }, now)),
  }));
  return { missing: false, alreadyCancelled: false, reminder };
}

async function updateBlobReminder(id, makeNext) {
  const pathname = reminderPath(id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await readBlobReminder(pathname);
    if (!stored?.reminder) return null;
    const now = new Date().toISOString();
    const next = normalizeReminder(makeNext(stored.reminder, now));
    try {
      await put(pathname, JSON.stringify(next), {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json; charset=utf-8",
        cacheControlMaxAge: 60,
        ...(stored.etag ? { ifMatch: toIfMatchVersion(stored.etag) } : {}),
        ...getBlobAuthOptions(),
      });
      return next;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) || attempt === 2) throw error;
    }
  }
  return null;
}

async function readBlobReminder(pathname) {
  const stored = await get(pathname, { access: "private", useCache: false, ...getBlobAuthOptions() });
  if (!stored || stored.statusCode !== 200 || !stored.stream) return null;
  const reminder = normalizeReminder(JSON.parse(await streamToText(stored.stream)));
  return { reminder, etag: String(stored.blob?.etag || "") };
}

function reminderPath(id) {
  const safeId = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  return `${REMINDER_PREFIX}${safeId || "invalid"}.json`;
}

function normalizeReminder(value) {
  const reminder = value && typeof value === "object" ? value : {};
  return {
    id: String(reminder.id || ""),
    title: String(reminder.title || ""),
    message: String(reminder.message || ""),
    recipientEmail: String(reminder.recipientEmail || ""),
    dueAt: reminder.dueAt ? new Date(reminder.dueAt).toISOString() : "",
    timezone: String(reminder.timezone || "Asia/Jerusalem"),
    status: String(reminder.status || "scheduled"),
    providerId: String(reminder.providerId || ""),
    providerStatus: String(reminder.providerStatus || ""),
    lastError: String(reminder.lastError || ""),
    createdAt: reminder.createdAt ? new Date(reminder.createdAt).toISOString() : "",
    updatedAt: reminder.updatedAt ? new Date(reminder.updatedAt).toISOString() : "",
    cancelledAt: reminder.cancelledAt ? new Date(reminder.cancelledAt).toISOString() : "",
    events: Array.isArray(reminder.events) ? reminder.events.slice(-MAX_EVENT_HISTORY) : [],
  };
}

function createEvent(type, details, createdAt) {
  return {
    type: String(type || "scheduled"),
    createdAt,
    providerId: String(details?.providerId || ""),
    error: String(details?.lastError || ""),
  };
}

function appendEvent(events, event) {
  return [...(Array.isArray(events) ? events : []), event].slice(-MAX_EVENT_HISTORY);
}

function toIfMatchVersion(version) {
  return String(version || "").startsWith("W/") ? String(version).slice(2) : String(version || "");
}

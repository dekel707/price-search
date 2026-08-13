import crypto from "node:crypto";
import postgres from "postgres";
import { findUnexpectedOrderRemovals, mergeRecentMissingOrders } from "./_order-conflict-recovery.js";

let sqlClient = null;
let schemaPromise = null;

export function hasDatabaseStorageCredentials() {
  return Boolean(getDatabaseUrl());
}

export async function readDatabaseState() {
  const sql = await getSql();
  const [row] = await sql`
    SELECT state, version, updated_at
    FROM price_search_state
    WHERE id = 1
  `;
  return row ? databaseRecord(row) : null;
}

export async function initializeDatabaseState(initialState) {
  const sql = await getSql();

  return sql.begin(async (transaction) => {
    const [current] = await transaction`
      SELECT state, version, updated_at
      FROM price_search_state
      WHERE id = 1
      FOR UPDATE
    `;
    if (current) return databaseRecord(current);

    const capturedAt = new Date();
    const version = crypto.randomUUID();
    const serializedState = JSON.stringify(initialState);
    await transaction`
      INSERT INTO price_search_state (id, state, version, updated_at)
      VALUES (1, ${serializedState}::jsonb, ${version}, ${capturedAt})
    `;
    await insertBackup(transaction, initialState, "database-migration", capturedAt);

    return { state: initialState, version, updatedAt: capturedAt.toISOString() };
  });
}

export async function saveDatabaseState(payload, expectedVersion, { action = "state-change" } = {}) {
  const sql = await getSql();

  return sql.begin(async (transaction) => {
    const [currentRow] = await transaction`
      SELECT state, version, updated_at
      FROM price_search_state
      WHERE id = 1
      FOR UPDATE
    `;

    if (!currentRow) return { missing: true };

    const current = databaseRecord(currentRow);
    const capturedAt = new Date();
    const blockedOrderRemovals = findUnexpectedOrderRemovals(current.state, payload, action, capturedAt);
    if (blockedOrderRemovals.length) {
      const backup = await insertBackup(transaction, payload, `blocked-order-removal-${action}`, capturedAt);
      return { blockedOrderRemovals, current, backup };
    }
    if (expectedVersion !== current.version) {
      if (statesMatchIgnoringSaveMetadata(current.state, payload)) {
        return { alreadyCurrent: true, current };
      }
      const conflictBackup = await insertBackup(transaction, payload, `conflict-${action}`, capturedAt);
      const recovery = mergeRecentMissingOrders(current.state, payload, capturedAt);
      if (recovery.recovered) {
        const previousBackup = await insertBackup(transaction, current.state, `before-conflict-${action}`, capturedAt);
        const backup = await insertBackup(transaction, recovery.state, `recovered-${action}`, capturedAt);
        const version = crypto.randomUUID();
        const serializedState = JSON.stringify(recovery.state);
        const [saved] = await transaction`
          UPDATE price_search_state
          SET state = ${serializedState}::jsonb,
              version = ${version},
              updated_at = ${capturedAt}
          WHERE id = 1
          RETURNING state, version, updated_at
        `;
        return {
          recovered: true,
          current: databaseRecord(saved),
          backup,
          previousBackup,
          conflictBackup,
          addedOrders: recovery.addedOrders,
          addedCustomers: recovery.addedCustomers,
          reservationAdjustments: recovery.reservationAdjustments,
        };
      }
      const backup = conflictBackup;
      return { conflict: true, current, backup };
    }

    const previousBackup = await insertBackup(transaction, current.state, `before-${action}`, capturedAt);
    const backup = await insertBackup(transaction, payload, `after-${action}`, capturedAt);
    const version = crypto.randomUUID();
    const serializedState = JSON.stringify(payload);
    const [saved] = await transaction`
      UPDATE price_search_state
      SET state = ${serializedState}::jsonb,
          version = ${version},
          updated_at = ${capturedAt}
      WHERE id = 1
      RETURNING state, version, updated_at
    `;

    return {
      ok: true,
      current: databaseRecord(saved),
      backup,
      previousBackup,
    };
  });
}

export async function createDatabaseBackup(state, { reason = "manual", capturedAt = new Date() } = {}) {
  const sql = await getSql();
  return insertBackup(sql, state, reason, capturedAt);
}

export async function listDatabaseBackups(limit = 30) {
  const sql = await getSql();
  const safeLimit = Math.max(1, Math.min(100, Number.parseInt(limit, 10) || 30));
  const rows = await sql`
    SELECT id, captured_at, reason
    FROM price_search_state_backups
    ORDER BY captured_at DESC, id DESC
    LIMIT ${safeLimit}
  `;

  return rows.map((row) => ({
    id: Number(row.id),
    capturedAt: new Date(row.captured_at).toISOString(),
    reason: String(row.reason),
    storage: "database",
  }));
}

export async function saveCatalogSpecifications(catalog) {
  const sql = await getSql();
  const items = catalog?.items && typeof catalog.items === "object" ? catalog.items : {};
  const rows = Object.entries(items)
    .filter(([skuKey, attributes]) => skuKey && attributes && typeof attributes === "object")
    .map(([skuKey, attributes]) => ({
      skuKey: String(skuKey),
      model: String(attributes?.identity?.model || skuKey),
      attributes,
    }));

  if (!rows.length) throw new Error("catalog_specifications_empty");

  return sql.begin(async (transaction) => {
    // This table is a separate, read-only technical catalog. Replacing it in
    // one transaction can never affect business state, orders, stock or their
    // backups in price_search_state.
    await transaction`DELETE FROM price_search_catalog_specifications`;
    for (const row of rows) {
      await transaction`
        INSERT INTO price_search_catalog_specifications (sku_key, model, attributes, updated_at)
        VALUES (${row.skuKey}, ${row.model}, ${JSON.stringify(row.attributes)}::jsonb, NOW())
      `;
    }
    return { count: rows.length };
  });
}

export async function getCatalogSpecificationStatus() {
  const sql = await getSql();
  const [row] = await sql`
    SELECT COUNT(*)::int AS count, MAX(updated_at) AS updated_at
    FROM price_search_catalog_specifications
  `;
  return {
    count: Number(row?.count || 0),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function readCatalogSpecificationSummaries() {
  const sql = await getSql();
  const rows = await sql`
    SELECT sku_key, COALESCE(attributes->>'searchSummary', '') AS search_summary
    FROM price_search_catalog_specifications
  `;
  return new Map(rows.map((row) => [String(row.sku_key), String(row.search_summary || "")]));
}

export async function readCatalogSpecifications() {
  const sql = await getSql();
  const rows = await sql`
    SELECT sku_key, attributes
    FROM price_search_catalog_specifications
    ORDER BY sku_key
  `;
  return Object.fromEntries(rows.map((row) => [String(row.sku_key), typeof row.attributes === "string" ? JSON.parse(row.attributes) : row.attributes]));
}

// Scheduled email reminders intentionally live in their own table rather than
// inside price_search_state. They are operational notifications, not business
// data, so creating or cancelling one can never overwrite orders, customers,
// stock or reservations in the shared state document.
export async function listScheduledEmailReminders(limit = 120) {
  const sql = await getSql();
  const safeLimit = Math.max(1, Math.min(300, Number.parseInt(limit, 10) || 120));
  const rows = await sql`
    SELECT id, title, message, recipient_email, due_at, timezone, status,
           provider_id, provider_status, last_error, created_at, updated_at,
           cancelled_at
    FROM price_search_scheduled_reminders
    WHERE status <> 'deleted'
    ORDER BY due_at DESC, created_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map(scheduledReminderRecord);
}

export async function getScheduledEmailReminder(id) {
  const sql = await getSql();
  const [row] = await sql`
    SELECT id, title, message, recipient_email, due_at, timezone, status,
           provider_id, provider_status, last_error, created_at, updated_at,
           cancelled_at
    FROM price_search_scheduled_reminders
    WHERE id = ${String(id || "")}
    LIMIT 1
  `;
  return row ? scheduledReminderRecord(row) : null;
}

export async function createScheduledEmailReminder(reminder) {
  const sql = await getSql();
  const now = new Date();
  const id = String(reminder.id || "");

  return sql.begin(async (transaction) => {
    const [existing] = await transaction`
      SELECT id, title, message, recipient_email, due_at, timezone, status,
             provider_id, provider_status, last_error, created_at, updated_at,
             cancelled_at
      FROM price_search_scheduled_reminders
      WHERE id = ${id}
      FOR UPDATE
    `;
    if (existing) return { reminder: scheduledReminderRecord(existing), alreadyExists: true };

    const [created] = await transaction`
      INSERT INTO price_search_scheduled_reminders (
        id, title, message, recipient_email, due_at, timezone, status,
        provider_id, provider_status, last_error, created_at, updated_at
      )
      VALUES (
        ${id},
        ${String(reminder.title || "")},
        ${String(reminder.message || "")},
        ${String(reminder.recipientEmail || "")},
        ${new Date(reminder.dueAt)},
        ${String(reminder.timezone || "Asia/Jerusalem")},
        ${String(reminder.status || "scheduled")},
        ${String(reminder.providerId || "")},
        ${String(reminder.providerStatus || "scheduled")},
        ${String(reminder.lastError || "")},
        ${now},
        ${now}
      )
      RETURNING id, title, message, recipient_email, due_at, timezone, status,
                provider_id, provider_status, last_error, created_at, updated_at,
                cancelled_at
    `;
    const eventType = String(reminder.eventType || reminder.status || "scheduled");
    await transaction`
      INSERT INTO price_search_scheduled_reminder_events (reminder_id, event_type, details, created_at)
      VALUES (
        ${id},
        ${eventType},
        ${JSON.stringify({ dueAt: new Date(reminder.dueAt).toISOString(), providerId: String(reminder.providerId || "") })}::jsonb,
        ${now}
      )
    `;
    return { reminder: scheduledReminderRecord(created), alreadyExists: false };
  });
}

export async function updateScheduledEmailReminderDelivery(id, { status, providerId = "", providerStatus = "", lastError = "" }) {
  const sql = await getSql();
  const safeId = String(id || "");
  const now = new Date();
  return sql.begin(async (transaction) => {
    const [updated] = await transaction`
      UPDATE price_search_scheduled_reminders
      SET status = ${String(status || "scheduled")},
          provider_id = ${String(providerId || "")},
          provider_status = ${String(providerStatus || "")},
          last_error = ${String(lastError || "")},
          updated_at = ${now}
      WHERE id = ${safeId}
      RETURNING id, title, message, recipient_email, due_at, timezone, status,
                provider_id, provider_status, last_error, created_at, updated_at,
                cancelled_at
    `;
    if (!updated) return null;
    await transaction`
      INSERT INTO price_search_scheduled_reminder_events (reminder_id, event_type, details, created_at)
      VALUES (
        ${safeId},
        ${String(status || "scheduled")},
        ${JSON.stringify({ providerId: String(providerId || ""), error: String(lastError || "") })}::jsonb,
        ${now}
      )
    `;
    return scheduledReminderRecord(updated);
  });
}

export async function cancelScheduledEmailReminder(id) {
  const sql = await getSql();
  const safeId = String(id || "");
  const now = new Date();

  return sql.begin(async (transaction) => {
    const [current] = await transaction`
      SELECT id, title, message, recipient_email, due_at, timezone, status,
             provider_id, provider_status, last_error, created_at, updated_at,
             cancelled_at
      FROM price_search_scheduled_reminders
      WHERE id = ${safeId}
      FOR UPDATE
    `;
    if (!current) return { missing: true, reminder: null };
    if (String(current.status) === "cancelled") {
      return { missing: false, alreadyCancelled: true, reminder: scheduledReminderRecord(current) };
    }

    const [cancelled] = await transaction`
      UPDATE price_search_scheduled_reminders
      SET status = 'cancelled', provider_status = 'cancelled', cancelled_at = ${now}, updated_at = ${now}
      WHERE id = ${safeId}
      RETURNING id, title, message, recipient_email, due_at, timezone, status,
                provider_id, provider_status, last_error, created_at, updated_at,
                cancelled_at
    `;
    await transaction`
      INSERT INTO price_search_scheduled_reminder_events (reminder_id, event_type, details, created_at)
      VALUES (${safeId}, 'cancelled', ${JSON.stringify({ providerId: String(current.provider_id || "") })}::jsonb, ${now})
    `;
    return { missing: false, alreadyCancelled: false, reminder: scheduledReminderRecord(cancelled) };
  });
}

export async function deleteScheduledEmailReminder(id) {
  const sql = await getSql();
  const safeId = String(id || "");
  const now = new Date();

  return sql.begin(async (transaction) => {
    const [current] = await transaction`
      SELECT id, title, message, recipient_email, due_at, timezone, status,
             provider_id, provider_status, last_error, created_at, updated_at,
             cancelled_at
      FROM price_search_scheduled_reminders
      WHERE id = ${safeId}
      FOR UPDATE
    `;
    if (!current) return { missing: true, alreadyDeleted: false, reminder: null };
    if (String(current.status) === "deleted") {
      return { missing: false, alreadyDeleted: true, reminder: scheduledReminderRecord(current) };
    }

    const [deleted] = await transaction`
      UPDATE price_search_scheduled_reminders
      SET status = 'deleted', updated_at = ${now}
      WHERE id = ${safeId}
      RETURNING id, title, message, recipient_email, due_at, timezone, status,
                provider_id, provider_status, last_error, created_at, updated_at,
                cancelled_at
    `;
    await transaction`
      INSERT INTO price_search_scheduled_reminder_events (reminder_id, event_type, details, created_at)
      VALUES (${safeId}, 'deleted', ${JSON.stringify({ providerId: String(current.provider_id || "") })}::jsonb, ${now})
    `;
    return { missing: false, alreadyDeleted: false, reminder: scheduledReminderRecord(deleted) };
  });
}

async function getSql() {
  const url = getDatabaseUrl();
  if (!url) throw new Error("database_not_configured");

  if (!sqlClient) {
    sqlClient = postgres(url, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: "require",
    });
  }

  await ensureSchema(sqlClient);
  return sqlClient;
}

async function ensureSchema(sql) {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS price_search_state (
          id SMALLINT PRIMARY KEY CHECK (id = 1),
          state JSONB NOT NULL,
          version TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS price_search_state_backups (
          id BIGSERIAL PRIMARY KEY,
          captured_at TIMESTAMPTZ NOT NULL,
          reason TEXT NOT NULL,
          state JSONB NOT NULL
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS price_search_state_backups_captured_at_idx
        ON price_search_state_backups (captured_at DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS price_search_catalog_specifications (
          sku_key TEXT PRIMARY KEY,
          model TEXT NOT NULL,
          attributes JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS price_search_catalog_specifications_updated_at_idx
        ON price_search_catalog_specifications (updated_at DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS price_search_scheduled_reminders (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT '',
          recipient_email TEXT NOT NULL,
          due_at TIMESTAMPTZ NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
          status TEXT NOT NULL DEFAULT 'scheduled',
          provider_id TEXT NOT NULL DEFAULT '',
          provider_status TEXT NOT NULL DEFAULT '',
          last_error TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          cancelled_at TIMESTAMPTZ
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS price_search_scheduled_reminders_due_at_idx
        ON price_search_scheduled_reminders (due_at DESC)
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS price_search_scheduled_reminder_events (
          id BIGSERIAL PRIMARY KEY,
          reminder_id TEXT NOT NULL REFERENCES price_search_scheduled_reminders(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          details JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS price_search_scheduled_reminder_events_reminder_idx
        ON price_search_scheduled_reminder_events (reminder_id, created_at DESC)
      `;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

async function insertBackup(sql, state, reason, capturedAt) {
  const [row] = await sql`
    INSERT INTO price_search_state_backups (captured_at, reason, state)
    VALUES (${capturedAt}, ${safeReason(reason)}, ${JSON.stringify(state)}::jsonb)
    RETURNING id, captured_at, reason
  `;

  return {
    id: Number(row.id),
    capturedAt: new Date(row.captured_at).toISOString(),
    reason: String(row.reason),
    storage: "database",
  };
}

function databaseRecord(row) {
  return {
    state: typeof row.state === "string" ? JSON.parse(row.state) : row.state,
    version: String(row.version),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function scheduledReminderRecord(row) {
  return {
    id: String(row.id || ""),
    title: String(row.title || ""),
    message: String(row.message || ""),
    recipientEmail: String(row.recipient_email || ""),
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : "",
    timezone: String(row.timezone || "Asia/Jerusalem"),
    status: String(row.status || "scheduled"),
    providerId: String(row.provider_id || ""),
    providerStatus: String(row.provider_status || ""),
    lastError: String(row.last_error || ""),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : "",
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : "",
  };
}

function getDatabaseUrl() {
  return getEnvValue("POSTGRES_URL") || getEnvValue("DATABASE_URL") || getEnvValue("NEON_DATABASE_URL");
}

function safeReason(value) {
  return String(value || "manual")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "manual";
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

function getEnvValue(name) {
  return String(process.env[name] || "").replace(/^["']|["']$/g, "");
}

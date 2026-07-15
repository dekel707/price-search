import crypto from "node:crypto";
import postgres from "postgres";

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

export async function saveDatabaseState(payload, expectedVersion) {
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
    if (expectedVersion !== current.version) {
      const backup = await insertBackup(transaction, payload, "conflict-save", capturedAt);
      return { conflict: true, current, backup };
    }

    const previousBackup = await insertBackup(transaction, current.state, "before-save", capturedAt);
    const backup = await insertBackup(transaction, payload, "state-save", capturedAt);
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

function getDatabaseUrl() {
  return getEnvValue("POSTGRES_URL") || getEnvValue("DATABASE_URL") || getEnvValue("NEON_DATABASE_URL");
}

function safeReason(value) {
  return String(value || "manual")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "manual";
}

function getEnvValue(name) {
  return String(process.env[name] || "").replace(/^["']|["']$/g, "");
}

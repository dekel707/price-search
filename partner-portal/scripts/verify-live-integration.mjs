import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const base = process.env.PARTNER_PORTAL_URL || "https://price-search-eitan-portal.vercel.app";
const ownerPin = process.env.PARTNER_PORTAL_OWNER_PIN;
const eitanPin = process.env.PARTNER_PORTAL_EITAN_PIN;
if (!ownerPin || !eitanPin) throw new Error("PARTNER_PORTAL_OWNER_PIN_and_PARTNER_PORTAL_EITAN_PIN_are_required");

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const index = line.indexOf("=");
    if (index < 1 || line.trimStart().startsWith("#")) return [];
    return [[line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")]];
  }));
}

const deployedEnv = parseEnv(await readFile(process.env.PARTNER_PORTAL_ENV_PATH || ".env.local", "utf8"));
const cronSecret = process.env.PARTNER_PORTAL_CRON_SECRET || deployedEnv.CRON_SECRET;
assert.ok(deployedEnv.TEAM_PORTAL_DATABASE_URL, "a separate partner database URL is required");
assert.ok(cronSecret, "the Vercel Cron secret is required");

async function login(pin) {
  const response = await fetch(`${base}/api/portal?action=login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }),
  });
  assert.equal(response.status, 200, "portal login must succeed");
  return response.headers.get("set-cookie").split(";")[0];
}

async function request(cookie, path, body) {
  const response = await fetch(`${base}/api/portal${path}`, {
    method: body ? "POST" : "GET",
    headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  assert.ok(response.ok, `${path} failed: ${JSON.stringify(payload)}`);
  return { payload, headers: response.headers };
}

const sql = postgres(deployedEnv.TEAM_PORTAL_DATABASE_URL, { ssl: "require", max: 1 });
try {
  const owner = await login(ownerPin);
  const eitan = await login(eitanPin);
  const initial = await request(eitan, "?resource=dashboard");
  assert.equal(initial.payload.customers, 0, "live integration test requires an empty partner database");
  assert.equal(initial.payload.pendingOrders, 0, "live integration test requires no prior partner orders");
  assert.equal(initial.headers.get("x-portal-isolation"), "partner-database-only");

  const customer = await request(owner, "?action=save-entity", { entity: "customer", values: { name: "__בדיקת נעילת שריון__", phone: "0000000000" } });
  const reservation = await request(owner, "?action=save-entity", { entity: "reservation", values: { customerId: customer.payload.id, productModel: "__TEST-LOCK-ONLY__", quantity: 3 } });
  const [first, second] = await Promise.all([
    request(eitan, "?action=create-order", { customerId: customer.payload.id, items: [{ model: "__TEST-LOCK-ONLY__", name: "מוצר בדיקת נעילה", quantity: 2 }] }),
    request(eitan, "?action=create-order", { customerId: customer.payload.id, items: [{ model: "__TEST-LOCK-ONLY__", name: "מוצר בדיקת נעילה", quantity: 2 }] }),
  ]);
  const reservations = await request(eitan, "?resource=reservations");
  const locked = reservations.payload.items.find((item) => item.id === reservation.payload.id);
  const allocated = [first, second].flatMap(({ payload }) => payload.reservationWithdrawals || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  assert.equal(allocated, 3, "parallel orders must not consume more than the three reserved units");
  assert.equal(Number(locked.remaining_quantity), 0, "reservation must never become negative");
  const backupsDuringTest = (await request(owner, "?resource=backups")).payload.items.length;
  assert.ok(backupsDuringTest >= 8, "every changing operation must create before/after backups");

  // This portal is brand-new. Test data is removed directly from its own new
  // database only, then an empty daily backup is created for a clean handover.
  await sql.unsafe("TRUNCATE partner_reservation_ledger, partner_order_items, partner_orders, partner_reservations, partner_aging, partner_customers, partner_audit_events, partner_backups");
  const cron = await fetch(`${base}/api/portal?action=daily-backup`, { method: "POST", headers: { Authorization: `Bearer ${cronSecret}` } });
  const cronPayload = await cron.json();
  assert.equal(cron.status, 200, `clean backup failed: ${JSON.stringify(cronPayload)}`);
  const final = await request(eitan, "?resource=dashboard");
  const cleanBackups = (await request(owner, "?resource=backups")).payload.items.length;
  assert.deepEqual(final.payload, { pendingOrders: 0, customers: 0, reservationWithdrawals: 0, myOrders: 0 });
  assert.equal(cleanBackups, 1, "exactly one clean handover backup must remain");
  console.log(JSON.stringify({ parallelOrders: 2, reservedUnitsAllocated: allocated, reservationRemaining: Number(locked.remaining_quantity), backupsDuringTest, cleanBackupCreated: true, finalDashboard: final.payload }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../api/portal.js", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");

for (const value of ["TEAM_PORTAL_DATABASE_URL", "TEAM_PORTAL_OWNER_PIN", "TEAM_PORTAL_EITAN_PIN", "TEAM_PORTAL_AUTH_SECRET", "TEAM_PORTAL_CRON_SECRET"]) {
  assert.match(env, new RegExp(`^${value}=`, "m"), `missing isolated environment variable: ${value}`);
}
for (const value of ["partner_customers", "partner_reservations", "partner_orders", "partner_backups", "partner_reservation_ledger", "before-order-create", "after-order-create", "daily-scheduled", "FOR UPDATE"]) {
  assert.ok(api.includes(value), `missing safety control: ${value}`);
}
assert.match(api, /TEAM_PORTAL_CATALOG_URL/);
assert.match(api, /fetch\(config\.catalogUrl/);
assert.ok(!api.includes("/api/state"), "partner API must never write to the main state endpoint");
assert.ok(!api.includes("BLOB_READ_WRITE_TOKEN"), "partner API must never reuse main Blob storage credentials");
assert.ok(!api.includes("process.env.DATABASE_URL"), "partner API must not read the main database credential");
assert.match(app, /הזמנות איתן/);
assert.match(app, /משיכות משריון/);
assert.match(app, /orderSearchInput/);
assert.match(app, /advancedSearchInput/);
assert.match(app, /הטעינה מתעכבת/);
console.log("Partner portal isolation checks passed.");

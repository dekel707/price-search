import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../api/portal.js", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
for (const value of ["partner_customers", "partner_reservations", "partner_orders", "partner_backups", "partner_reservation_ledger", "before-order-create", "after-order-create", "before-order-update", "after-order-update", "before-order-delete", "after-order-delete", "daily-scheduled", "FOR UPDATE"]) {
  assert.ok(api.includes(value), `missing safety control: ${value}`);
}
assert.match(api, /TEAM_PORTAL_CATALOG_URL/);
assert.match(api, /fetch\(config\.catalogUrl/);
assert.match(api, /TEAM_PORTAL_MAIN_SYNC_SECRET/);
assert.match(api, /x-eitan-sync/);
assert.match(api, /TEAM_PORTAL_MAIN_ORDER_SECRET/);
assert.match(api, /x-eitan-order/);
assert.match(api, /sent_to_main/);
assert.match(api, /sync_action/);
assert.match(api, /created_by = 'eitan'/);
assert.ok(!api.includes("/api/state"), "partner API must never write to the main state endpoint");
assert.ok(!api.includes("BLOB_READ_WRITE_TOKEN"), "partner API must never reuse main Blob storage credentials");
assert.ok(!api.includes("process.env.DATABASE_URL"), "partner API must not read the main database credential");
assert.match(app, /שלח שריון בוואטסאפ/);
assert.match(app, /מהשריון/);
assert.match(app, /orderSearchInput/);
assert.match(app, /advancedSearchInput/);
assert.match(app, /cartCustomerDialog/);
assert.match(app, /stockQuantity/);
assert.match(app, /data-edit-order/);
assert.match(app, /data-delete-order/);
assert.ok(!app.includes("data-advanced-add"), "advanced search must stay read-only");
assert.match(app, /pendingDeleteId/);
assert.match(app, /activeTab/);
const logo = await readFile(new URL("../public/fujicom_logo.svg", import.meta.url), "utf8");
assert.match(logo, /<svg/);
assert.match(app, /הטעינה מתעכבת/);
console.log("Partner portal isolation checks passed.");

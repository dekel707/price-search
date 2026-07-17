import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [mainApi, mainApp, mainHtml, partnerApi] = await Promise.all([
  readFile(new URL("../api/eitan-orders.js", import.meta.url), "utf8"),
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../partner-portal/api/portal.js", import.meta.url), "utf8"),
]);

assert.match(mainApi, /isAuthorized/);
assert.match(mainApi, /EITAN_PORTAL_BRIDGE_SECRET/);
assert.match(mainApi, /owner-queue/);
assert.ok(!mainApi.includes("/api/state"), "approval queue must not write to the main state API");
assert.match(partnerApi, /TEAM_PORTAL_OWNER_BRIDGE_SECRET/);
assert.match(partnerApi, /owner-queue-approve/);
assert.match(mainApp, /eitan-orders/);
assert.match(mainHtml, /אישור כאן משנה רק את סטטוס הפיילוט/);
console.log("Eitan approval bridge safety checks passed.");

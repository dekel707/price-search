import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [mainApi, liveDataApi, mainApp, mainHtml, partnerApi] = await Promise.all([
  readFile(new URL("../api/eitan-orders.js", import.meta.url), "utf8"),
  readFile(new URL("../api/eitan-live-data.js", import.meta.url), "utf8"),
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../partner-portal/api/portal.js", import.meta.url), "utf8"),
]);

assert.match(mainApi, /isAuthorized/);
assert.match(mainApi, /EITAN_PORTAL_BRIDGE_SECRET/);
assert.match(mainApi, /owner-queue/);
assert.ok(!mainApi.includes("/api/state"), "approval queue must not write to the main state API");
assert.match(mainApi, /savePartnerMainState/);
assert.match(mainApi, /eitan-order-approval/);
assert.match(mainApi, /getOrderReportDateForDraft/);
assert.match(liveDataApi, /EITAN_PORTAL_SYNC_SECRET/);
assert.ok(!liveDataApi.includes("state.orders"), "partner sync must not disclose the main order history");
assert.ok(!liveDataApi.includes("state.settings"), "partner sync must not disclose main settings");
assert.match(partnerApi, /TEAM_PORTAL_OWNER_BRIDGE_SECRET/);
assert.match(partnerApi, /TEAM_PORTAL_MAIN_SYNC_SECRET/);
assert.match(partnerApi, /owner-queue-claim/);
assert.match(partnerApi, /owner-queue-complete/);
assert.match(mainApp, /eitan-orders/);
assert.match(mainHtml, /אישור כאן יוצר הזמנה אחת במערכת הראשית/);
console.log("Eitan approval bridge safety checks passed.");

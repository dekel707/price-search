import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

const dashboardStart = app.indexOf("function renderDashboard()");
const dashboardEnd = app.indexOf("function renderDashboardTrends", dashboardStart);
const dashboard = app.slice(dashboardStart, dashboardEnd);
assert.match(dashboard, /orders\.filter\(\(order\) => getOrderReportDateKey\(order\)\.startsWith\(todayKey\.slice\(0, 7\)\)\)/, "monthly sales must include every saved order in the current report month, including tomorrow");
assert.doesNotMatch(dashboard, /drafts\./, "drafts must stay outside dashboard sales calculations");

const monthlyStart = app.indexOf("function getMonthlySalesReportValue");
const monthlyEnd = app.indexOf("function getMonthlySalesAdjustmentLabel", monthlyStart);
const monthly = app.slice(monthlyStart, monthlyEnd);
assert.match(monthly, /function getMonthlySalesAdjustmentBaselineGross\(/, "monthly manual alignment must retain a historical baseline");
assert.match(monthly, /grossValue: roundMoney\(actualGross \+ adjustmentGross\)/, "new saved orders must be added on top of the monthly alignment");
assert.match(monthly, /getPaidSalesTotal\(order\.items\)/, "only paid order value may be counted in monthly revenue");

assert.match(app, /const CLOUD_LIVE_REFRESH_INTERVAL_MS = 10_000/, "the app must check cloud changes frequently");
assert.match(app, /window\.addEventListener\("focus", refreshCloudStateInBackground\)/, "returning to the app must refresh external orders immediately");
assert.match(app, /document\.addEventListener\("visibilitychange"/, "visible tabs must refresh external updates");
assert.match(app, /if \(pendingCloudSave \|\| readPendingCloudSave\(\)\) return false/, "cloud refresh must never overwrite a local pending save");
assert.match(app, /remoteStateVersion === cloudStateVersion/, "unchanged cloud data must not re-render and interrupt an open form");

console.log("Live sales and safe cloud refresh checks passed.");

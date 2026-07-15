import assert from "node:assert/strict";
import {
  getAutomaticOrderReportDateKey,
  getOrderReportDateForDraft,
  getUpcomingSundayIsraelDateKey,
  isOrderReportDateCompleted,
} from "../src/order-schedule.js";

function automatic(timestamp, expected, label) {
  assert.equal(getAutomaticOrderReportDateKey(timestamp), expected, label);
}

// July is daylight-saving time in Israel (UTC+3). The hour before/after 15:00
// verifies the policy boundary independently of the computer's own time zone.
automatic("2026-07-12T11:59:59.000Z", "2026-07-12", "Sunday before 15:00 stays today");
automatic("2026-07-12T12:00:00.000Z", "2026-07-13", "Sunday from 15:00 moves to Monday");
automatic("2026-07-15T12:00:00.000Z", "2026-07-16", "Wednesday from 15:00 moves to Thursday");
automatic("2026-07-16T11:59:59.000Z", "2026-07-16", "Thursday before 15:00 stays Thursday");
automatic("2026-07-16T12:00:00.000Z", "2026-07-19", "Thursday from 15:00 moves to Sunday");
automatic("2026-07-17T08:00:00.000Z", "2026-07-19", "Friday moves to Sunday");
automatic("2026-07-18T20:59:59.000Z", "2026-07-19", "Saturday remains Sunday until Sunday begins");
automatic("2026-07-19T00:01:00.000Z", "2026-07-19", "Sunday returns to same-day policy before 15:00");

assert.equal(
  getOrderReportDateForDraft("2026-07-12T12:10:00.000Z", false, true),
  "2026-07-12",
  "explicit today override keeps a late order on today",
);
assert.equal(
  getOrderReportDateForDraft("2026-07-16T12:10:00.000Z", true, false),
  "2026-07-19",
  "manual tomorrow cannot pull a Thursday-after-15:00 order before Sunday",
);
assert.equal(
  getUpcomingSundayIsraelDateKey("2026-07-19T09:00:00.000Z"),
  "2026-07-19",
  "Sunday dashboard key is today, not the following Sunday",
);
assert.equal(
  isOrderReportDateCompleted("2026-07-12", "2026-07-12T20:59:59.000Z"),
  false,
  "an order remains open until the final second of its report day",
);
assert.equal(
  isOrderReportDateCompleted("2026-07-12", "2026-07-12T21:00:00.000Z"),
  true,
  "an order moves to completed at Israel midnight after its report day",
);

console.log("Order scheduling checks passed.");

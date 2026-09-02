import assert from "node:assert/strict";
import {
  createReservationImportPlan,
  detectReservationReportColumns,
  getReservationReportSignature,
  parseReservationReportRows,
  resolveReservationCustomer,
  verifyReservationReportPasses,
} from "../src/reservation-report-core.js";

const customers = [
  { id: "customer-clean", name: "לקוח תקין" },
  { id: "customer-protected", name: "לקוח מוגן" },
];

const rows = [
  ["שם לקוח", "מספר פריט", "תאור פריט", "כמות", "יתרה לאספקה"],
  ["לקוח תקין", "MODEL-1", "מוצר ראשון", 999, 2],
  ["לקוח תקין", "MODEL-1", "מוצר ראשון", 999, 3],
  ["לקוח תקין", "MODEL-2", "מוצר שני", 999, 0],
  ["לקוח מוגן", "MODEL-3", "מוצר שלישי", 999, 7],
  ["לקוח מוגן", "", "שורה פגומה", 999, 4],
  ["לקוח שאינו קיים", "MODEL-X", "לא לשיוך", 999, 8],
];

const detected = detectReservationReportColumns(rows);
assert.equal(detected.columns.quantity, 4, "the outstanding-delivery balance must beat a generic quantity column");

const reports = Array.from({ length: 3 }, () => parseReservationReportRows(rows, { customers }));
const report = verifyReservationReportPasses(reports);
assert.equal(report.isFullReport, true, "outstanding-delivery reports must use full replacement semantics");
assert.equal(report.sourceRowCount, 6);
assert.equal(report.acceptedRowCount, 4);
assert.equal(report.totalQuantity, 12);
assert.equal(report.entries.find((entry) => entry.skuKey === "MODEL-1")?.quantity, 5, "duplicate source lines must be summed");
assert.deepEqual(report.protectedCustomerIds, ["customer-protected"], "a malformed row must protect that customer's full snapshot");
assert.equal(report.issues.length, 2, "bad and unknown rows must be isolated instead of blocking clean customers");

const existing = [
  { id: "old-clean", customerId: "customer-clean", customerName: "לקוח תקין", skuKey: "OLD", sku: "OLD", description: "ישן", quantity: 11 },
  { id: "old-protected", customerId: "customer-protected", customerName: "לקוח מוגן", skuKey: "SAFE", sku: "SAFE", description: "אסור למחוק", quantity: 19 },
  { id: "other", customerId: "unrelated", customerName: "לקוח אחר", skuKey: "OTHER", sku: "OTHER", description: "לא קשור", quantity: 23 },
];
const plan = createReservationImportPlan(existing, report);
assert.deepEqual(plan.safeEntries.map((entry) => entry.customer.id), ["customer-clean", "customer-clean"]);
assert.equal(plan.removed, 1, "only stale entries of a fully clean customer may be removed");
assert.ok(plan.keptReservations.some((item) => item.id === "old-protected"), "the protected customer's old reservation must survive");
assert.ok(plan.keptReservations.some((item) => item.id === "other"), "unrelated reservations must survive");

const imported = plan.safeEntries.map((entry) => ({
  id: `${entry.customer.id}-${entry.skuKey}`,
  customerId: entry.customer.id,
  customerName: entry.customer.name,
  skuKey: entry.skuKey,
  sku: entry.sku,
  description: entry.description,
  quantity: entry.quantity,
}));
const afterFirstImport = [...plan.keptReservations, ...imported];
const secondPlan = createReservationImportPlan(afterFirstImport, report);
assert.equal(secondPlan.added, 0, "re-importing the same report must not create duplicates");
assert.equal(secondPlan.removed, 0, "re-importing the same report must be idempotent");
assert.equal(secondPlan.safeEntries.length, imported.length);

const declaredMismatchRows = [
  ["דוח מלאי משוריין"],
  ["לקוח", "לקוח תקין"],
  ["סה\"כ יחידות", 10],
  [],
  ["דגם", "תיאור", "כמות שנותרה"],
  ["MODEL-1", "מוצר", 9],
];
const mismatch = parseReservationReportRows(declaredMismatchRows, { customers });
assert.equal(mismatch.declaredTotal, 10);
assert.deepEqual(mismatch.protectedCustomerIds, ["customer-clean"], "a declared-total mismatch must protect the entire customer");
assert.ok(mismatch.issues.some((issue) => issue.type === "declared-total-mismatch"));

const ambiguousCustomers = [
  { id: "a", name: "חשמל הצפון 1 2" },
  { id: "b", name: "חשמל הצפון 2 1" },
];
assert.equal(resolveReservationCustomer("חשמל הצפון 1 2", ambiguousCustomers).status, "matched");
assert.equal(resolveReservationCustomer("חשמל הצפון 2 1 בעמ", ambiguousCustomers).status, "unknown");

const changedPass = structuredClone(report);
changedPass.entries[0].quantity += 1;
assert.throws(
  () => verifyReservationReportPasses([report, report, changedPass]),
  /בדיקת הדוח המשולשת לא התאימה/,
  "any disagreement between the three reads must block the import",
);
assert.notEqual(getReservationReportSignature(report), getReservationReportSignature(changedPass));

console.log("Reservation import core safety scenarios passed.");

import assert from "node:assert/strict";
import { basename } from "node:path";
import { readSheet } from "read-excel-file/node";
import {
  detectReservationReportColumns,
  parseReservationReportRows,
  verifyReservationReportPasses,
} from "../src/reservation-report-core.js";

const paths = process.argv.slice(2);
if (!paths.length) throw new Error("Pass one or more reservation .xlsx paths to this verification script.");

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function collectCustomers(rows, headerRowIndex, customerColumn) {
  const names = new Set();
  if (customerColumn !== undefined) {
    rows.slice(headerRowIndex + 1).forEach((row) => {
      const name = clean(row[customerColumn]);
      if (name) names.add(name);
    });
  } else {
    rows.slice(0, headerRowIndex).forEach((row) => {
      const labelIndex = row.findIndex((cell) => /לקוח|customer|client/i.test(clean(cell)));
      const name = labelIndex >= 0 ? clean(row[labelIndex + 1]) : "";
      if (name) names.add(name);
    });
  }
  return [...names].map((name, index) => ({ id: `workbook-customer-${index + 1}`, name }));
}

for (const path of paths) {
  const threeReads = await Promise.all([readSheet(path), readSheet(path), readSheet(path)]);
  const { columns, headerRowIndex } = detectReservationReportColumns(threeReads[0]);
  const customers = collectCustomers(threeReads[0], headerRowIndex, columns.customer);
  const reports = threeReads.map((rows) => parseReservationReportRows(rows, { customers }));
  const report = verifyReservationReportPasses(reports);

  assert.equal(report.issues.length, 0, `${basename(path)} contains rows that the importer would isolate`);
  assert.equal(report.protectedCustomerIds.length, 0, `${basename(path)} unexpectedly protects a customer`);
  assert.ok(report.acceptedRowCount > 0, `${basename(path)} has no accepted rows`);
  assert.ok(report.entries.length > 0, `${basename(path)} has no unique reservation entries`);
  assert.equal(
    report.totalQuantity,
    report.entries.reduce((sum, entry) => sum + entry.quantity, 0),
    `${basename(path)} aggregate quantity differs from its parsed rows`,
  );
  if (report.declaredTotal !== null) {
    assert.equal(report.totalQuantity, report.declaredTotal, `${basename(path)} differs from its declared total`);
  }

  console.log(JSON.stringify({
    file: basename(path),
    sourceRows: report.sourceRowCount,
    uniqueReservations: report.entries.length,
    customers: report.seenCustomerIds.length,
    units: report.totalQuantity,
    duplicateRowsCombined: report.acceptedRowCount - report.entries.length,
    fullReport: report.isFullReport,
    checks: 3,
  }));
}

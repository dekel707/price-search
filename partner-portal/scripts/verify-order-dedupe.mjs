import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

const sourcePath = new URL("../api/portal.js", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const sourceWithoutImports = source.replace(/^import .*;\n/gm, "");
const sharedModule = sourceWithoutImports.slice(0, sourceWithoutImports.indexOf("export default async function handler"));
const { createOrderDedupeKey } = new Function("crypto", `${sharedModule}\nreturn { createOrderDedupeKey };`)(crypto);

const baseLine = {
  model: "FJ-DF28WE",
  skuKey: "FJ-DF28WE",
  quantity: 1,
  unitPrice: 700,
  listPrice: 700,
};

const cashKey = createOrderDedupeKey("customer-test", [{ ...baseLine, fromReservation: false, reservationQuantity: 0 }]);
const omittedReservationKey = createOrderDedupeKey("customer-test", [{ ...baseLine, fromReservation: false }]);
const reservedKey = createOrderDedupeKey("customer-test", [{ ...baseLine, fromReservation: true, reservationQuantity: 1 }]);

assert.equal(cashKey, omittedReservationKey, "an order without a reservation must accept zero or omitted reservation quantity");
assert.notEqual(cashKey, reservedKey, "reservation use must remain part of the duplicate fingerprint");
assert.throws(() => createOrderDedupeKey("customer-test", [{ ...baseLine, fromReservation: true, reservationQuantity: -1 }]), /invalid_quantity/);

console.log("Partner portal order fingerprint checks passed.");

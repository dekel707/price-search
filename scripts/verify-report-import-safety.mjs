import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const reservationCore = await readFile(new URL("../src/reservation-report-core.js", import.meta.url), "utf8");
const collectionImport = await readFile(new URL("../api/import-collections.js", import.meta.url), "utf8");

// Reservation reports are parsed from the uploaded file three separate times.
assert.match(app, /for \(let pass = 0; pass < 3; pass \+= 1\)/, "Excel reports must have three independent read passes");
assert.match(app, /Array\.from\(\{ length: 3 \}, \(\) => parseReservationSpreadsheetRows/, "pasted reports must have three parse passes");
assert.match(app, /function verifyReservationReportPasses\(reports\)/, "reservation import must centralize verification");
assert.match(reservationCore, /בדיקת הדוח המשולשת לא התאימה/, "mismatched passes must block reservation updates");
assert.match(reservationCore, /protectedCustomerIds\.add/, "invalid rows must protect existing customer reservations");
assert.match(reservationCore, /safeEntries/, "valid rows must be planned separately from isolated rows");
assert.match(reservationCore, /declared-total-mismatch/, "declared report totals must be verified");
assert.match(app, /reservation-import/, "the completed import must use a single explicit cloud-save action");
assert.match(app, /לא בוצעה שמירת ענן מיותרת/, "an unchanged re-import must not waste a Vercel write");
assert.match(app, /waitForCloudSaveToBecomeIdle/, "reservation import must wait for an existing save instead of failing immediately");
assert.match(app, /flush it exactly once/, "a pending save must be flushed without a Vercel polling loop");
assert.match(app, /הדוח נבדק 3 פעמים/, "the operator must be shown that the report passed three checks");

// Aging PDFs are extracted three times on the server before the browser can save them.
assert.match(collectionImport, /const third = await extractCollectionReport\(data\.slice\(\)\);/, "aging reports must have a third extraction pass");
assert.match(collectionImport, /createReportSignature\(third\) !== signature/, "the third aging extraction must match the first");
assert.match(collectionImport, /verifiedPasses: 3/, "the API must report triple verification");
assert.match(app, /Number\(result\.verifiedPasses\) >= 3/, "the UI must only call the aging report verified after all three checks");

console.log("Reservation and aging report triple-verification checks passed.");

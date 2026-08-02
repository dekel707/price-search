import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const collectionImport = await readFile(new URL("../api/import-collections.js", import.meta.url), "utf8");

// Reservation reports are parsed from the uploaded file three separate times.
assert.match(app, /for \(let pass = 0; pass < 3; pass \+= 1\)/, "Excel reports must have three independent read passes");
assert.match(app, /Array\.from\(\{ length: 3 \}, \(\) => parseReservationSpreadsheetRows/, "pasted reports must have three parse passes");
assert.match(app, /function verifyReservationReportPasses\(reports\)/, "reservation import must centralize verification");
assert.match(app, /בדיקת הדוח המשולשת לא התאימה/, "mismatched passes must block reservation updates");
assert.match(app, /first\.invalidRows\.length/, "partial or invalid report rows must block reservation updates");
assert.match(app, /first\.skippedCustomerNames\.length/, "unknown customers must block reservation updates");
assert.match(app, /הדוח נבדק 3 פעמים/, "the operator must be shown that the report passed three checks");

// Aging PDFs are extracted three times on the server before the browser can save them.
assert.match(collectionImport, /const third = await extractCollectionReport\(data\.slice\(\)\);/, "aging reports must have a third extraction pass");
assert.match(collectionImport, /createReportSignature\(third\) !== signature/, "the third aging extraction must match the first");
assert.match(collectionImport, /verifiedPasses: 3/, "the API must report triple verification");
assert.match(app, /Number\(result\.verifiedPasses\) >= 3/, "the UI must only call the aging report verified after all three checks");

console.log("Reservation and aging report triple-verification checks passed.");

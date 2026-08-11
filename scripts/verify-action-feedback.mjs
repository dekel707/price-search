import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, styles] = await Promise.all([
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
]);

assert.match(app, /function runUiAction\(/, "חסר מנגנון חסימת לחיצה כפולה");
assert.match(app, /const inFlightUiActions = new Set\(\)/, "פעולות מקבילות אינן נחסמות");
assert.match(app, /key: "cart-order-commit"/, "שמור ו‑WhatsApp חייבים לחלוק מנגנון מניעת כפילות");
assert.match(app, /key: isCartAction \? "ai-proposal-cart" : "ai-proposal-commit"/, "פעולות העוזר לא מוגנות מלחיצה כפולה");
assert.match(app, /button\.setAttribute\("aria-busy", "true"\)/, "אין חיווי נגיש לפעולה שמתבצעת");
assert.match(app, /showActionToast\(pendingMessage, "progress"\)/, "אין חיווי מיידי בזמן ביצוע פעולה");
assert.match(app, /return true;\n}\n\nfunction renderCart\(\)/, "שליחת WhatsApp צריכה להחזיר סטטוס הצלחה למנגנון הפעולות");
assert.match(app, /import\("read-excel-file\/browser"\)/, "טעינת Excel אינה מפוצלת לפי צורך");
assert.match(app, /import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/, "טעינת PDF אינה מפוצלת לפי צורך");
assert.match(app, /import\("tesseract\.js"\)/, "טעינת OCR אינה מפוצלת לפי צורך");
assert.match(app, /scheduleAdvancedSearchMetadataWarmup\(\)/, "נתוני חיפוש מתקדם לא נטענים ברקע לאחר המסך הראשי");
assert.match(styles, /\.action-toast\[data-kind="progress"\]/, "חסר עיצוב לחיווי פעולה בתהליך");
assert.match(styles, /\.action-toast\[data-kind="error"\]/, "חסר עיצוב לחיווי שגיאה");
assert.match(styles, /\.is-pending/, "לחצן בפעולה אינו מסומן באופן חזותי");

console.log("Action feedback, double-tap protection and deferred loading checks passed.");

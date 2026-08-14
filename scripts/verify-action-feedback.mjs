import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, styles, html] = await Promise.all([
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
]);

assert.match(app, /function runUiAction\(/, "חסר מנגנון חסימת לחיצה כפולה");
assert.match(app, /const inFlightUiActions = new Set\(\)/, "פעולות מקבילות אינן נחסמות");
assert.match(app, /key: "cart-order-commit"/, "שמור ו‑WhatsApp חייבים לחלוק מנגנון מניעת כפילות");
assert.match(app, /function getCoalescedCloudSaveAction\(/, "שמירה ממתינה חייבת לשמר הרשאת מחיקת הזמנה");
assert.match(app, /function rebaseQueuedCloudSaveVersion\(/, "שמירה שהמתינה לפעולה קודמת חייבת לקבל את גרסת הענן החדשה");
assert.match(app, /rebaseQueuedCloudSaveVersion\(envelope\.id, cloudStateVersion\)/, "גרסת שמירה ממתינה אינה מתעדכנת אחרי הצלחה");
assert.match(app, /action: "advanced-search", label: "חיפוש מתקדם"/, "חסר קיצור דרך לחיפוש מתקדם בדאשבורד");
assert.match(app, /if \(action === "advanced-search"\)/, "קיצור החיפוש המתקדם אינו מחובר ללשונית");
assert.match(app, /key: isCartAction \? "ai-proposal-cart" : "ai-proposal-commit"/, "פעולות העוזר לא מוגנות מלחיצה כפולה");
assert.match(app, /button\.setAttribute\("aria-busy", "true"\)/, "אין חיווי נגיש לפעולה שמתבצעת");
assert.match(app, /showActionToast\(pendingMessage, "progress"\)/, "אין חיווי מיידי בזמן ביצוע פעולה");
assert.match(app, /return true;\n}\n\nfunction renderCart\(\)/, "שליחת WhatsApp צריכה להחזיר סטטוס הצלחה למנגנון הפעולות");
assert.match(app, /import\("read-excel-file\/browser"\)/, "טעינת Excel אינה מפוצלת לפי צורך");
assert.match(app, /import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/, "טעינת PDF אינה מפוצלת לפי צורך");
assert.match(app, /import\("tesseract\.js"\)/, "טעינת OCR אינה מפוצלת לפי צורך");
assert.match(app, /scheduleAdvancedSearchMetadataWarmup\(\)/, "נתוני חיפוש מתקדם לא נטענים ברקע לאחר המסך הראשי");
assert.match(html, /id="scheduledReminderEmailPreview"/, "חסרה תצוגה מקדימה למייל בתזכורות");
assert.match(html, /class="scheduled-reminder-native-control"/, "שדות התאריך והשעה אינם מוגנים מגלישה ב-Safari");
assert.match(app, /function renderScheduledReminderEmailPreview\(\)/, "התצוגה המקדימה של התזכורת אינה מתעדכנת");
assert.match(app, /scheduledReminderForm\.addEventListener\("input", renderScheduledReminderEmailPreview\)/, "הקלדה בתזכורת אינה מעדכנת את התצוגה המקדימה");
assert.match(app, /scheduledReminderDate\.addEventListener\("input", commitScheduledReminderDateSelection\)/, "בחירת תאריך במובייל אינה נקלטת מיד");
assert.match(app, /document\.activeElement === dom\.scheduledReminderDate/, "בורר התאריך אינו נסגר לאחר בחירה תקינה");
assert.match(styles, /\.scheduled-reminder-email-preview-card/, "חסר עיצוב לתצוגה המקדימה של המייל");
assert.match(styles, /\.scheduled-reminder-native-control \{[\s\S]*?overflow: hidden;/, "המסגרת של התאריך והשעה אינה חוסמת גלישה ב-Safari");
assert.match(styles, /\.action-toast\[data-kind="progress"\]/, "חסר עיצוב לחיווי פעולה בתהליך");
assert.match(styles, /\.action-toast\[data-kind="error"\]/, "חסר עיצוב לחיווי שגיאה");
assert.match(styles, /\.is-pending/, "לחצן בפעולה אינו מסומן באופן חזותי");

const queueHelpersSource = app.slice(
  app.indexOf("function getCoalescedCloudSaveAction"),
  app.indexOf("function rememberCloudSaveResult"),
);
const queueHelpers = new Function(`
  let pendingCloudSave = { id: "pending-delete", action: "order-delete", stateVersion: "version-before" };
  let persisted = null;
  function persistPendingCloudSave(value) { persisted = structuredClone(value); }
  ${queueHelpersSource}
  return {
    coalesce: getCoalescedCloudSaveAction,
    rebase(completedId, version) {
      const changed = rebaseQueuedCloudSaveVersion(completedId, version);
      return { changed, pending: structuredClone(pendingCloudSave), persisted };
    },
  };
`)();

assert.equal(queueHelpers.coalesce("order-delete", "state-change"), "order-delete", "מחיקה ממתינה איבדה את הרשאת המחיקה");
assert.equal(queueHelpers.coalesce("order-create", "order-edit"), "order-edit", "פעולה רגילה לא הוחלפה בפעולה החדשה");
const rebased = queueHelpers.rebase("completed-create", "version-after-create");
assert.equal(rebased.changed, true, "שמירה ממתינה לא קיבלה גרסה חדשה");
assert.equal(rebased.pending.stateVersion, "version-after-create", "גרסת השמירה הממתינה נשארה ישנה");
assert.equal(rebased.persisted.stateVersion, "version-after-create", "גרסת ההתאוששות המקומית לא עודכנה");

console.log("Action feedback, double-tap protection and deferred loading checks passed.");

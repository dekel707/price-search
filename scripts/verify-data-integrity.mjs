import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, stateApi, database, backups, manifestText, fallbackText] = await Promise.all([
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../api/state.js", import.meta.url), "utf8"),
  readFile(new URL("../api/_database.js", import.meta.url), "utf8"),
  readFile(new URL("../api/_state-backups.js", import.meta.url), "utf8"),
  readFile(new URL("../public/specs.json", import.meta.url), "utf8"),
  readFile(new URL("../catalog/public/catalog-fallback.json", import.meta.url), "utf8"),
]);

const fallback = JSON.parse(fallbackText);
const facts = fallback.products.flatMap((product) => product.technical?.facts || []);
const energyRatings = fallback.products
  .map((product) => product.technical?.performance?.energyRating)
  .filter(Boolean);

assert(!app.includes('activeTab = readJson(ACTIVE_TAB_KEY)'), "רענון האתר אינו יכול לשחזר לשונית ישנה");
assert(app.includes('activeTab = "search";'), "מסך החיפוש חייב להיות ברירת המחדל בכל כניסה");
assert(app.includes("localStorage.removeItem(ACTIVE_TAB_KEY)"), "בחירת לשונית ישנה חייבת להימחק ברענון");
assert(app.includes("advancedCleanEnergyRating"), "דירוג אנרגטי חייב לעבור אימות לפני הצגה");

const highlightsStart = app.indexOf("function getAdvancedProductHighlights");
const highlightsEnd = app.indexOf("function getAdvancedSpecificationRows");
const highlights = app.slice(highlightsStart, highlightsEnd);
assert(!highlights.includes("energyRating"), "דירוג אנרגטי לא יוצג כתגית בולטת");

assert(!manifestText.includes("\ufffd"), "שמות קבצים פגומים אינם יכולים להיכנס למאגר המפרטים");
assert(facts.length > 1000, "נעלמו יותר מדי פרטי מפרט בבדיקת הניקוי");
facts.forEach((fact) => {
  assert(!/[?？�]/.test(fact), `נשאר סימן לא ברור במפרט: ${fact}`);
  assert(!/(?:https?:\/\/|www\.)/i.test(fact), `נשאר קישור שאינו מאפיין מוצר: ${fact}`);
  assert(!/^\s*[•|,;:]/.test(fact), `נשארה פתיחה לא תקינה במפרט: ${fact}`);
  assert(!/:\s*$/.test(fact), `נשאר משפט קטוע במפרט: ${fact}`);
});
assert(energyRatings.length >= 80, "דירוגים אנרגטיים תקינים חייבים להישמר בתוך המפרט");
energyRatings.forEach((rating) => assert(/^[A-G](?:\+{0,3})$/.test(rating), `דירוג אנרגטי לא תקין: ${rating}`));

assert(app.includes("persistPendingCloudSave(envelope)"), "כל שמירה חייבת להשאיר עותק התאוששות מקומי לפני העלאה");
assert(stateApi.includes("createStateBackup(currentPayload"), "שמירת Blob חייבת לגבות את המצב הקודם");
assert(stateApi.includes("createStateBackup(payload"), "שמירת Blob חייבת לגבות את המצב החדש");
assert(stateApi.includes("ensureDailyStateBackup"), "נדרש גיבוי יומי בענן");
assert(database.includes("const previousBackup = await insertBackup(transaction, current.state"), "מסד הנתונים חייב לגבות את המצב הקודם בכל פעולה");
assert(database.includes("const backup = await insertBackup(transaction, payload"), "מסד הנתונים חייב לגבות את המצב החדש בכל פעולה");
assert(backups.includes("createDailyStateBackup"), "חסר ארכיון גיבוי יומי נפרד");

console.log(`תקין: ${fallback.products.length} דגמים, ${facts.length} פרטי מפרט נקיים, ${energyRatings.length} דירוגים אנרגטיים, וגיבוי לפני ואחרי כל שמירה.`);

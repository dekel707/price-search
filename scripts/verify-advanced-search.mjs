import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, app, styles, catalogText] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../src/app.js", import.meta.url), "utf8"),
  readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../data/catalog-attributes.json", import.meta.url), "utf8"),
]);
const catalog = JSON.parse(catalogText);

assert(page.includes('data-tab="advanced-search"'), "חסרה לשונית חיפוש מתקדם");
assert(page.includes('data-tab-panel="advanced-search"'), "חסר חלון חיפוש מתקדם");
assert(page.includes('id="advancedSearchInput"'), "חסר שדה החיפוש המתקדם");
assert(page.includes('id="advancedSearchResults"'), "חסרות תוצאות החיפוש המתקדם");
assert(page.includes('id="advancedNearbyOptions"'), "חסרות אפשרויות קרובות בחיפוש המתקדם");
assert(page.includes('id="searchInput"'), "שדה החיפוש הקיים אינו קיים");
assert(page.includes('id="results"'), "תוצאות החיפוש הקיימות אינן קיימות");

assert(app.includes("function renderAdvancedSearch()"), "חסר מנוע התצוגה של החיפוש המתקדם");
assert(app.includes("ADVANCED_CATEGORY_TABS"), "חסרות קטגוריות מפורטות בחיפוש המתקדם");
assert(app.includes('key: "top-freezer"'), "חסרה קטגוריית מקפיא עליון");
assert(app.includes('key: "bottom-freezer"'), "חסרה קטגוריית מקפיא תחתון");
assert(app.includes('"zero-line", "↔ קו אפס"'), "חסר מסנן קו אפס");
assert(app.includes("getAdvancedQuickFilterGroups"), "חסרים מסננים מהירים לפי קטגוריה");
assert(app.includes("getAdvancedSearchContext"), "החיפוש המתקדם אינו מזהה נתון מספרי לחיפוש קרוב");
assert(app.includes("advancedGetNearbyMetricValues"), "החיפוש המתקדם אינו מציע ערכים קרובים");
assert(app.includes("advancedGetProximityTolerance"), "החיפוש המתקדם אינו מגביל טווח קרוב לפי סוג נתון");
assert(app.includes("sendAdvancedSpecificationToWhatsApp"), "חסרה שליחת מפרט מלא ב‑WhatsApp לדגם ללא דף מוצר");
assert(app.includes("createAdvancedSpecificationMessage"), "חסרה יצירת הודעת מפרט מלאה ל‑WhatsApp");
assert(app.includes("sendAdvancedProductPageToWhatsApp"), "חסרה שליחת דף מוצר ב‑WhatsApp");
assert(app.includes("createAdvancedProductPageMessage"), "חסרה יצירת הודעה עם קישור לדף מוצר");
assert(app.includes("data-send-advanced-product-page"), "חסר כפתור שליחת דף מוצר בכרטיס עם דף מוצר");
assert(app.includes("details.open = Boolean(activeValue);"), "מסנני החיפוש המתקדם אינם סגורים כברירת מחדל");
assert(app.includes("advancedSearchQuickFilters[quickGroup] = advancedSearchQuickFilters[quickGroup] === value ? \"\" : value"), "בחירה חוזרת במסנן מהיר אינה מבטלת אותו");

const advancedRendererStart = app.indexOf("function renderAdvancedSearch()");
const advancedRendererEnd = app.indexOf("function searchProducts(query)");
const advancedRegion = app.slice(advancedRendererStart, advancedRendererEnd);
assert(advancedRendererStart >= 0 && advancedRendererEnd > advancedRendererStart, "אזור החיפוש המתקדם אינו תחום כראוי");
["addToCart", "queueCloudSave", "saveOrders", "saveCart", "saveProducts", "saveCustomers"].forEach((forbidden) => {
  assert(!advancedRegion.includes(forbidden), `החיפוש המתקדם אינו קריאה בלבד: נמצא ${forbidden}`);
});
assert(!advancedRegion.includes("product.documents.forEach((document)"), "מסמכי מוצר אינם יכולים להסתיר את רכיב הדפדפן בזמן ציור הכרטיס");

assert(styles.includes(".advanced-search-panel"), "חסר עיצוב מבודד לחיפוש המתקדם");
assert(styles.includes(".advanced-search-filter-panel"), "חסר אזור הסינון המתקדם");
assert(styles.includes("overscroll-behavior: contain;"), "גלילת המסננים המתקדמים אינה מבודדת");
assert(styles.includes(".advanced-search-results"), "חסר עיצוב לכרטיסי התוצאות המתקדמות");
assert(styles.includes(".advanced-nearby-options"), "חסר עיצוב לאפשרויות קרובות");
assert(styles.includes(".advanced-spec-whatsapp"), "חסר כפתור WhatsApp למפרט חסר");
assert(styles.includes(".advanced-document-whatsapp"), "חסר עיצוב לכפתור שליחת דף מוצר ב‑WhatsApp");

const specifications = Object.values(catalog.items || {});
assert(specifications.length >= 120, "מאגר המפרטים קטן מהמצופה");
assert(specifications.some((item) => /קו\s*אפס/.test([...(item.features || []), ...(item.sourceFacts || [])].join(" "))), "לא נמצאו נתוני קו אפס במפרטים");
assert(specifications.some((item) => item.capacities?.washKg), "לא נמצאו קיבולות למכונות כביסה במפרטים");
assert(specifications.some((item) => item.dimensionsCm?.heightCm), "לא נמצאו מידות במפרטים");

console.log(`תקין: חיפוש מתקדם מבודד, ${specifications.length} מפרטים זמינים, עם נתונים קרובים ושליחת מפרט לדגם חסר מסמך.`);

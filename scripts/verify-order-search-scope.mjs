import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const resultStart = app.indexOf("function renderResultNodes(");
const resultEnd = app.indexOf("function getProductDocuments(");
const orderSearch = app.slice(resultStart, resultEnd);

assert(resultStart >= 0 && resultEnd > resultStart, "לא נמצא אזור תוצאות החיפוש להזמנות");
assert(orderSearch.includes("dataset.addToCart"), "החיפוש הקיים חייב להישאר מחובר להוספה לסל");
assert(orderSearch.includes("dataset.addTenPlusOne"), "החיפוש הקיים חייב להישאר מחובר למבצע 10+1");
assert(!orderSearch.includes("getProductDocuments("), "קישורי דף מוצר אינם אמורים להופיע בחיפוש להזמנות");
assert(!orderSearch.includes("data.productSpec"), "חיפוש ההזמנות לא אמור ליצור כפתור דף מוצר");
assert(!orderSearch.includes("data.productInstallation"), "חיפוש ההזמנות לא אמור ליצור כפתור התקנה");

console.log("חיפוש ההזמנות נשאר ממוקד בסל ובהזמנות, ללא קישורי מפרטים.");

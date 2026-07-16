import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("index.html");
const app = read("src/app.js");
const styles = read("src/styles.css");

assert(html.includes('id="actionToast"'), "A global deletion confirmation container must exist.");
assert(html.includes('id="actionToastMessage"'), "The deletion confirmation needs a readable message.");
assert(app.includes("function showActionToast(message)"), "Deletion feedback must be displayed globally.");
assert(app.includes("function announceDeletion(message)"), "Deletion feedback must also update the accessible status text.");
assert(app.includes('announceDeletion("הקטגוריה נמחקה.")'));
assert(app.includes('announceDeletion("ההערה נמחקה.")'));
assert(app.includes('announceDeletion("תאריך החזרה למלאי נמחק.")'));
assert(app.includes('announceDeletion(`${reservation.sku || "המוצר"} נמחק מהשריון.`)'));
assert(app.includes('announceDeletion("התזכורת נמחקה.")'));
assert(app.includes('announceDeletion("ההזמנה נמחקה. הדוחות והשריונים עודכנו.")'));
assert(app.includes('announceDeletion(futureStockOrder ? "הזמנת המלאי העתידי והתזכורת שלה נמחקו." : "הטיוטה נמחקה.")'));
assert(styles.includes(".action-toast"), "The deletion confirmation must be visible in every tab.");
assert(styles.includes(".action-toast.visible"), "The confirmation must animate into view.");

console.log("Delete feedback checks passed.");

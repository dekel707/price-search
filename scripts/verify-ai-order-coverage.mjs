import assert from "node:assert/strict";
import { __test } from "../api/ai-order.js";

const customers = [{ id: "customer-fadaa", name: "פדאא חברה לחשמל ורהיטים בע\"מ", code: "" }];
const catalog = [
  { skuKey: "FJ-DF117WE", sku: "FJ-DF117WE", description: "מקרר משרדי 86 ליטר לבן", price: 390 },
  { skuKey: "FJ-KS90BG", sku: "FJ-KS90BG", description: "מקרר משרדי דלת זכוכית שחורה", price: 475 },
  { skuKey: "FJ-43UIL900", sku: "FJ-43UIL900", description: "טלוויזיה חכמה 43 אינץ׳", price: 750 },
];

const omittedMiniFridge = __test.createOrderProposal({
  instruction: "תכין לפדאא טלוויזיה אחת ומקרר משרדי אחד",
  intent: {
    customerQuery: "פדאא",
    items: [{ productQuery: "טלוויזיה", sku: "FJ-43UIL900", quantity: 1 }],
  },
  catalog,
  customers,
  reservations: [],
});

assert.equal(omittedMiniFridge.ready, false, "פריט שביקשו והוא הושמט אינו יכול להישמר");
assert.deepEqual(
  omittedMiniFridge.unmatched.map((item) => [item.query, item.reason]),
  [["מקרר משרדי", "omitted_from_request"]],
  "המקרר המשרדי החסר חייב להופיע באופן ברור בהצעה",
);

const includedMiniFridge = __test.createOrderProposal({
  instruction: "תכין לפדאא טלוויזיה אחת ומקרר משרדי אחד FJ-DF117WE",
  intent: {
    customerQuery: "פדאא",
    items: [
      { productQuery: "טלוויזיה", sku: "FJ-43UIL900", quantity: 1 },
      { productQuery: "מקרר משרדי", sku: "FJ-DF117WE", quantity: 1 },
    ],
  },
  catalog,
  customers,
  reservations: [],
});

assert.equal(includedMiniFridge.ready, true, "פריט מפורש עם דגם מדויק צריך להישאר ניתן לשמירה");
assert.equal(includedMiniFridge.items.length, 2, "שני פריטים מזוהים חייבים להיכלל בהצעה");
assert.equal(includedMiniFridge.unmatched.length, 0, "לא אמורים להישאר פריטים חסרים כאשר שני הדגמים קיימים");

console.log("AI order coverage checks passed.");

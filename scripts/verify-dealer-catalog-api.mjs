import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const endpoint = fs.readFileSync(path.join(root, "api/dealer-catalog.js"), "utf8");

assert(endpoint.includes("Public, read-only catalog endpoint"));
assert(endpoint.includes('response.setHeader("Access-Control-Allow-Origin", "*")'));
assert(endpoint.includes('response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS")'));
assert(endpoint.includes("const products = sanitizeProducts"));
assert(endpoint.includes("model,"));
assert(endpoint.includes("name,"));
assert(endpoint.includes("readCatalogAttributes"));
assert(endpoint.includes("sanitizeTechnicalAttributes"));
assert(endpoint.includes("assertDealerCatalogPrivacy(products)"), "The public catalog must fail closed when a commercial field is added.");
assert(endpoint.includes("DEALER_PRIVATE_FIELDS"), "The public catalog must maintain an explicit private-field denylist.");
assert(endpoint.includes("isDealerSafeFact"), "The public catalog must strip stock and price language from technical facts.");
assert(endpoint.includes("category: technical.category"));
assert(endpoint.includes("colors: [...new Set([...inferColors(name), ...technical.colors])"));
assert(endpoint.includes("facts,"));
assert(endpoint.includes("documents: getDocuments"));
assert(!endpoint.includes("price: product.price"), "The public catalog must never expose prices.");
assert(!endpoint.includes("stockQuantity:"), "The public catalog must never expose stock quantities.");
assert(!endpoint.includes("customers:"), "The public catalog must never expose customers.");
assert(!endpoint.includes("orders:"), "The public catalog must never expose orders.");
assert(!endpoint.includes("reservations:"), "The public catalog must never expose reservations.");
assert(!endpoint.includes("localStorage"), "The public catalog browser must not reuse an old cached payload.");

console.log("Dealer catalog API safety checks passed.");

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
assert(endpoint.includes("colors: inferColors(name)"));
assert(endpoint.includes("documents: getDocuments"));
assert(!endpoint.includes("price: product.price"), "The public catalog must never expose prices.");
assert(!endpoint.includes("stockQuantity:"), "The public catalog must never expose stock quantities.");
assert(!endpoint.includes("customers:"), "The public catalog must never expose customers.");
assert(!endpoint.includes("orders:"), "The public catalog must never expose orders.");
assert(!endpoint.includes("reservations:"), "The public catalog must never expose reservations.");

console.log("Dealer catalog API safety checks passed.");

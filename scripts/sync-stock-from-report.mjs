import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readXlsxFile from "read-excel-file/node";
import { get, put } from "@vercel/blob";

const STATE_PATH = "price-search/state.json";
const DEFAULT_DISCONTINUED_CATEGORY = "יצא ממגוון";

loadEnvFile(path.resolve(".env.local"));

const reportPath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const write = process.argv.includes("--write");

if (!reportPath) {
  console.error("Usage: node scripts/sync-stock-from-report.mjs <stock-report.xlsx> [--write]");
  process.exit(1);
}

const state = await readCloudState();
const stockEntries = await readStockReport(reportPath);
const result = applyStockEntriesToState(state, stockEntries);

if (!write) {
  printSummary("DRY RUN", result);
  process.exit(0);
}

const timestamp = new Date().toISOString();
const backupPath = path.resolve("tmp", `state-backup-before-stock-sync-${timestamp.replace(/[:.]/g, "-")}.json`);
fs.mkdirSync(path.dirname(backupPath), { recursive: true });
fs.writeFileSync(backupPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

state.updatedAt = timestamp;

await put(STATE_PATH, JSON.stringify(state), {
  access: "private",
  allowOverwrite: true,
  contentType: "application/json; charset=utf-8",
  cacheControlMaxAge: 60,
  token: getToken(),
});

const verifiedState = await readCloudState();
const verifiedProducts = normalizeProducts(verifiedState.products);
const verifiedStockCount = verifiedProducts.filter((product) => hasStockQuantity(product)).length;

printSummary("SYNCED", {
  ...result,
  backupPath,
  verifiedStockCount,
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, name, rawValue] = match;
    if (process.env[name]) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[name] = value;
  }
}

function getToken() {
  const token = cleanString(process.env.BLOB_READ_WRITE_TOKEN);
  if (!token) throw new Error("Missing BLOB_READ_WRITE_TOKEN in environment.");
  return token;
}

async function readCloudState() {
  const stored = await get(STATE_PATH, {
    access: "private",
    useCache: false,
    token: getToken(),
  });

  if (!stored || stored.statusCode !== 200 || !stored.stream) {
    throw new Error(`Could not read cloud state at ${STATE_PATH}.`);
  }

  return JSON.parse(await streamToText(stored.stream));
}

async function streamToText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function readStockReport(filePath) {
  const workbook = await readXlsxFile(filePath);
  const rows = Array.isArray(workbook?.[0]?.data) ? workbook[0].data : workbook;
  if (!Array.isArray(rows) || rows.length < 2) throw new Error("Stock report is empty.");

  const { columns, headerRowIndex } = detectStockColumns(rows);
  const grouped = new Map();

  rows.slice(headerRowIndex + 1).forEach((row, rowIndex) => {
    const sku = cleanString(row[columns.sku]);
    const skuKey = getSkuKey(sku);
    const stockQuantity = parseStockQuantity(row[columns.stockQuantity]);
    if (!skuKey || stockQuantity === null) return;

    const current = grouped.get(skuKey) || {
      sku,
      skuKey,
      description: columns.description === undefined ? "" : cleanString(row[columns.description]),
      stockQuantity: 0,
      rowNumbers: [],
    };
    current.stockQuantity += stockQuantity;
    current.rowNumbers.push(rowIndex + headerRowIndex + 2);
    if (!current.description && columns.description !== undefined) current.description = cleanString(row[columns.description]);
    grouped.set(skuKey, current);
  });

  return [...grouped.values()];
}

function detectStockColumns(rows) {
  let best = { score: -1, columns: {}, headerRowIndex: -1 };

  rows.slice(0, 30).forEach((row, rowIndex) => {
    const columns = {};
    row.forEach((cell, columnIndex) => {
      const label = normalizeHeader(cell);
      if (!label) return;

      if (columns.sku === undefined && hasAny(label, ["מקט", "sku", "item", "part", "מספר פריט", "דגם", "model"])) {
        columns.sku = columnIndex;
      }
      if (
        columns.description === undefined &&
        hasAny(label, ["תאור", "תיאור", "מוצר", "description", "desc", "name"])
      ) {
        columns.description = columnIndex;
      }
      if (
        columns.stockQuantity === undefined &&
        hasAny(label, ["יתרה", "מחסן", "מלאי", "כמות", "balance", "stock", "inventory", "qty"])
      ) {
        columns.stockQuantity = columnIndex;
      }
    });

    const score =
      Number(columns.sku !== undefined) +
      Number(columns.stockQuantity !== undefined) +
      Number(columns.description !== undefined) * 0.25;
    if (score > best.score) {
      best = {
        score,
        columns,
        headerRowIndex: columns.sku !== undefined && columns.stockQuantity !== undefined ? rowIndex : -1,
      };
    }
  });

  if (best.headerRowIndex < 0) {
    throw new Error("Could not detect SKU and stock quantity columns.");
  }

  return best;
}

function applyStockEntriesToState(state, stockEntries) {
  const products = normalizeProducts(state.products);
  const stockBySku = new Map(stockEntries.map((entry) => [entry.skuKey, entry.stockQuantity]));
  const productSkuKeys = new Set(products.map((product) => product.skuKey));
  const annotations = normalizeAnnotations(state.annotations);
  const categories = normalizeCategories(state.categories);
  let discontinuedCategory = categories.find(isDiscontinuedCategory) || "";

  let matched = 0;
  let zeroCategorized = 0;
  let restoredFromDiscontinued = 0;
  let low = 0;
  let medium = 0;
  let high = 0;

  const nextProducts = products.map((product) => {
    if (!stockBySku.has(product.skuKey)) {
      const { stockQuantity, ...withoutStock } = product;
      return withoutStock;
    }

    const stockQuantity = stockBySku.get(product.skuKey) ?? 0;
    matched += 1;
    if (stockQuantity < 10) low += 1;
    else if (stockQuantity <= 50) medium += 1;
    else high += 1;

    const annotation = annotations[product.skuKey] || { category: "", note: "", arrivalDate: "" };
    if (stockQuantity === 0) {
      if (!discontinuedCategory) {
        discontinuedCategory = DEFAULT_DISCONTINUED_CATEGORY;
        categories.push(discontinuedCategory);
        categories.sort((a, b) => a.localeCompare(b, "he"));
      }
      if (annotation.category !== discontinuedCategory) {
        annotations[product.skuKey] = { ...annotation, category: discontinuedCategory };
      }
      zeroCategorized += 1;
    } else if (isDiscontinuedCategory(annotation.category)) {
      const nextAnnotation = { ...annotation, category: "" };
      if (nextAnnotation.note || nextAnnotation.arrivalDate) {
        annotations[product.skuKey] = nextAnnotation;
      } else {
        delete annotations[product.skuKey];
      }
      restoredFromDiscontinued += 1;
    }

    return { ...product, stockQuantity };
  });

  state.products = nextProducts.map(({ sku, description, price, stockQuantity }) => ({
    sku,
    description,
    price,
    ...(hasStockQuantity({ stockQuantity }) ? { stockQuantity } : {}),
  }));
  state.categories = categories;
  state.annotations = annotations;

  return {
    reportRows: stockEntries.length,
    matched,
    unmatched: stockEntries.filter((entry) => !productSkuKeys.has(entry.skuKey)).length,
    zeroCategorized,
    restoredFromDiscontinued,
    low,
    medium,
    high,
    productCount: products.length,
  };
}

function normalizeProducts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const sku = cleanString(item?.sku);
      const price = Number(item?.price);
      if (!sku || !Number.isFinite(price)) return null;
      const stockQuantity = parseStockQuantity(item?.stockQuantity);
      return {
        sku,
        skuKey: getSkuKey(item?.skuKey || sku),
        description: cleanString(item?.description),
        price,
        ...(stockQuantity !== null ? { stockQuantity } : {}),
      };
    })
    .filter(Boolean);
}

function normalizeCategories(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map(cleanString)
    .filter(Boolean)
    .filter((category) => {
      const key = normalizeSearch(category);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b, "he"));
}

function normalizeAnnotations(value) {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value).reduce((next, [skuKey, annotation]) => {
    const key = getSkuKey(skuKey);
    if (!key || !annotation || typeof annotation !== "object") return next;
    const category = cleanString(annotation.category);
    const note = cleanString(annotation.note);
    const arrivalDate = cleanString(annotation.arrivalDate);
    if (category || note || arrivalDate) next[key] = { category, note, arrivalDate };
    return next;
  }, {});
}

function isDiscontinuedCategory(category) {
  const key = normalizeSearch(category).replace(/\s+/g, "");
  return key === "יצאממגוון" || key === "יצאמהמגוון" || key === "יצאמהמהגוון";
}

function parseStockQuantity(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = typeof value === "number" ? value : Number(cleanString(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.floor(raw));
}

function hasStockQuantity(product) {
  return Number.isFinite(Number(product?.stockQuantity));
}

function normalizeHeader(value) {
  return normalizeSearch(value).replace(/["'״׳]/g, "");
}

function normalizeSearch(value) {
  return cleanString(value)
    .toLocaleLowerCase("he-IL")
    .normalize("NFKD")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[״"׳']/g, "")
    .replace(/[^\p{L}\p{N}.+-]+/gu, " ")
    .trim();
}

function hasAny(value, words) {
  return words.some((word) => value.includes(normalizeSearch(word)));
}

function getSkuKey(value) {
  return cleanString(value).toLocaleUpperCase("en-US");
}

function cleanString(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function printSummary(label, result) {
  console.log(`${label}: stock rows ${result.reportRows}, matched ${result.matched}/${result.productCount}, unmatched ${result.unmatched}`);
  console.log(`stock colors: low ${result.low}, medium ${result.medium}, high ${result.high}`);
  console.log(`zero categorized: ${result.zeroCategorized}, restored from discontinued: ${result.restoredFromDiscontinued}`);
  if (result.verifiedStockCount !== undefined) console.log(`verified stock products: ${result.verifiedStockCount}`);
  if (result.backupPath) console.log(`backup: ${result.backupPath}`);
}

import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(projectRoot, "public");
const imgDir = join(publicDir, "img");
const productsPath = join(publicDir, "products.json");
const outputPath = join(publicDir, "specs.json");
const MODEL_PATTERN = /\b(?:FJ|IT)\s*-\s*[A-Z0-9]+(?:\s*-\s*[A-Z0-9]+)?\b/g;
const MODEL_KEY_ALIASES = {
  FJFNF377W: "FJFNF377WE",
  FJNF513XBFIC: "FJNF513XBF",
  FJNF514DXBFIC: "FJNF514DXBF",
  FJNF516WBFIC: "FJNF516WBF",
  FJWM101W: "FJWM1014W",
};

const products = await readProducts();
const docs = await readPdfDocs();
const docsByModelKey = groupDocsByModelKey(docs);
const productSpecItems = buildProductSpecItems(products, docsByModelKey);
const lookup = buildLookup(docsByModelKey);
const matchedFileNames = new Set(Object.values(productSpecItems).flatMap((item) => item.files.map((file) => file.fileName)));

const manifest = {
  version: 1,
  source: "/img",
  totalPdfFiles: docs.length,
  productCount: products.length,
  matchedProducts: Object.keys(productSpecItems).length,
  unmatchedProducts: products.filter((product) => !productSpecItems[product.skuKey]).map((product) => product.sku),
  unmatchedDocuments: docs.filter((doc) => !matchedFileNames.has(doc.fileName)).map((doc) => doc.fileName),
  items: productSpecItems,
  lookup,
  documents: docs.map((doc) => ({
    fileName: doc.fileName,
    url: doc.url,
    modelKeys: doc.modelKeys,
    installation: doc.installation,
  })),
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      specs: outputPath,
      pdfFiles: manifest.totalPdfFiles,
      productCount: manifest.productCount,
      matchedProducts: manifest.matchedProducts,
      lookupKeys: Object.keys(lookup).length,
    },
    null,
    2,
  ),
);

async function readProducts() {
  const data = JSON.parse(await readFile(productsPath, "utf8"));
  const items = Array.isArray(data) ? data : data.products || [];
  return items
    .map((item) => ({
      sku: cleanString(item.sku),
      skuKey: getSkuKey(item.sku),
      modelKey: getModelKey(item.sku),
    }))
    .filter((item) => item.skuKey && item.modelKey);
}

async function readPdfDocs() {
  let entries = [];
  try {
    entries = await readdir(imgDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".pdf")
    .map((entry) => createPdfDoc(entry.name))
    .filter((doc) => doc.modelKeys.length)
    .sort((a, b) => a.fileName.localeCompare(b.fileName, "en"));
}

function createPdfDoc(fileName) {
  const safeFileName = normalizeFilename(fileName);
  const stem = safeFileName.slice(0, -extname(safeFileName).length);
  const modelKeys = extractModelKeys(stem);
  return {
    fileName: safeFileName,
    url: encodeURI(`/img/${fileName}`),
    modelKeys,
    installation: /הוראות|התקנה|install|manual/i.test(stem),
    duplicate: /\(\d+\)/.test(stem),
  };
}

function extractModelKeys(value) {
  const normalized = normalizeFilename(value).toLocaleUpperCase("en-US");
  const keys = new Set();

  for (const match of normalized.matchAll(MODEL_PATTERN)) {
    const model = match[0].replace(/\s*-\s*/g, "-");
    const fullKey = getModelKey(model);
    if (fullKey) keys.add(fullKey);

    const parts = model.split("-");
    const suffix = parts.at(-1) || "";
    if (parts.length > 2 && suffix.length <= 2) {
      const baseKey = getModelKey(parts.slice(0, -1).join("-"));
      if (baseKey) keys.add(baseKey);
    }
  }

  if (!keys.size) {
    const fallback = getModelKey(value);
    if (fallback) keys.add(fallback);
  }

  return [...keys].sort((a, b) => b.length - a.length || a.localeCompare(b, "en"));
}

function groupDocsByModelKey(docs) {
  return docs.reduce((groups, doc) => {
    doc.modelKeys.forEach((modelKey) => {
      const keys = [modelKey, MODEL_KEY_ALIASES[modelKey]].filter(Boolean);
      keys.forEach((key) => {
        if (!groups[key]) groups[key] = [];
        groups[key].push(doc);
      });
    });
    return groups;
  }, {});
}

function buildProductSpecItems(products, docsByKey) {
  return Object.fromEntries(
    products
      .map((product) => {
        const docs = sortDocs(docsByKey[product.modelKey] || []);
        if (!docs.length) return null;
        return [product.skuKey, toManifestItem(docs[0], docs)];
      })
      .filter(Boolean)
      .sort(([a], [b]) => a.localeCompare(b, "en")),
  );
}

function buildLookup(docsByKey) {
  return Object.fromEntries(
    Object.entries(docsByKey)
      .map(([modelKey, docs]) => [modelKey, toManifestItem(sortDocs(docs)[0], sortDocs(docs))])
      .sort(([a], [b]) => a.localeCompare(b, "en")),
  );
}

function sortDocs(docs) {
  return [...docs].sort((a, b) => scoreDoc(b) - scoreDoc(a) || a.fileName.localeCompare(b.fileName, "en"));
}

function scoreDoc(doc) {
  let score = 0;
  if (!doc.installation) score += 100;
  if (!doc.duplicate) score += 20;
  score -= doc.fileName.length / 1000;
  return score;
}

function toManifestItem(doc, docs) {
  return {
    url: doc.url,
    fileName: doc.fileName,
    label: doc.installation ? "הוראות התקנה" : "מפרט PDF",
    installation: doc.installation,
    files: docs.map((item) => ({
      url: item.url,
      fileName: item.fileName,
      label: item.installation ? "הוראות התקנה" : "מפרט PDF",
      installation: item.installation,
    })),
  };
}

function normalizeFilename(value) {
  return cleanString(value)
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\ufffd/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getModelKey(value) {
  return normalizeFilename(value).toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");
}

function getSkuKey(value) {
  return cleanString(value).toLocaleUpperCase("en-US");
}

function cleanString(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const catalogRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = path.resolve(catalogRoot, "..");
const productsData = JSON.parse(await readFile(path.join(appRoot, "public/products.json"), "utf8"));
const specs = JSON.parse(await readFile(path.join(appRoot, "public/specs.json"), "utf8"));
const origin = "https://price-search-teal.vercel.app";
const colorRules = [
  ["שחור", /שחור|black|\bbk\b/i],
  ["לבן", /לבן|white|\bwh\b/i],
  ["נירוסטה", /נירוסטה|inox|stainless|silver|\bss\b/i],
  ["אפור", /אפור|אפור[ה]?|grey|gray/i],
  ["שמנת", /שמנת|beige|cream/i],
  ["כסוף", /כסוף|chrome/i],
  ["אדום", /אדום|red/i],
];

const products = (productsData.products || productsData || [])
  .map((item) => {
    const model = clean(item.sku);
    const name = clean(item.description);
    if (!model || !name || model === "כללי") return null;
    const document = specs.items?.[model.toUpperCase()] || specs.lookup?.[modelKey(model)] || null;
    const files = Array.isArray(document?.files) ? document.files : document?.url ? [document] : [];
    return {
      model,
      name,
      colors: colorRules.filter(([, pattern]) => pattern.test(name)).map(([color]) => color),
      documents: files
        .filter((file) => clean(file.url))
        .map((file) => ({
          label: file.installation ? "הוראות התקנה" : "מפרט PDF",
          type: file.installation ? "installation" : "specification",
          url: new URL(file.url, origin).toString(),
        })),
    };
  })
  .filter(Boolean)
  .sort((left, right) => left.model.localeCompare(right.model, "en"));

await writeFile(
  path.join(catalogRoot, "public/catalog-fallback.json"),
  `${JSON.stringify({ version: 1, source: "build-fallback", updatedAt: null, products }, null, 2)}\n`,
);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function modelKey(value) {
  return clean(value).toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");
}

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const catalogRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = path.resolve(catalogRoot, "..");
const productsData = JSON.parse(await readFile(path.join(appRoot, "public/products.json"), "utf8"));
const specs = JSON.parse(await readFile(path.join(appRoot, "public/specs.json"), "utf8"));
const catalogAttributes = JSON.parse(await readFile(path.join(appRoot, "data/catalog-attributes.json"), "utf8"));
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
    const technical = sanitizeTechnicalAttributes(catalogAttributes.items?.[modelKey(model)], name);
    return {
      model,
      name,
      category: technical.category,
      colors: [...new Set([...colorRules.filter(([, pattern]) => pattern.test(name)).map(([color]) => color), ...technical.colors])],
      technical,
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

function cleanTechnicalFact(value) {
  const raw = clean(value);
  if (
    !raw ||
    /[?？�]/.test(raw) ||
    /(?:https?:\/\/|www\.)/i.test(raw) ||
    /\b(?:unknown|n\/?a|null|undefined)\b/i.test(raw) ||
    /^[\s•|,;:()\-–—.]+$/.test(raw) ||
    /:\s*$/.test(raw) ||
    (raw.includes("•") && (!raw.trim().startsWith("•") || (raw.match(/•/g) || []).length > 1))
  ) return "";

  const fact = raw
    .replace(/\b\d{10,14}\b/g, "")
    .replace(/^[\s•|,;:()\-–—]+/, "")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/[\s|,;·()\-–—]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!fact || fact.length < 3 || isTechnicalHeadingOrLooseValue(fact)) return "";
  if (/(?:\b(?:with|and|or)|עם|של|מול|מערכת|טכנולוגיית|חיבור|הפעלה|כולל|מובנה|לקליטת|לנוחיות|לרשת|לבהירות|מגירת|תאורת|עוצמת|צריכת)$/i.test(fact)) return "";
  return fact;
}

function cleanEnergyRating(value) {
  const rating = clean(value).toUpperCase();
  return /^[A-G](?:\+{0,3})$/.test(rating) ? rating : "";
}

function isTechnicalHeadingOrLooseValue(value) {
  return /^(?:(?:FJ|IT)[\s-]*[A-Z0-9-]+|להמחשה|גודל מסך|יחס תצוגה|רזולוציה|מידות(?: ללא מעמד| כולל מעמד)?|משקל|נפח(?: כללי)?|תא מזון|תא הקפאה|תא אפייה|קיבולת|הספק|תוכניות|תכניות|סל[״"]?ד|רמת רעש|צריכת מים|עוצמת יניקה|דירוג אנרגטי|צבע|ברקוד)$/i.test(value)
    || /^\d{1,2}:\d{1,2}$/.test(value)
    || /^\d+(?:\.\d+)?\s*(?:[״"]|ליטר|ק[״"]?ג|w|db|סל[״"]?ד|אינץ[׳']?)$/i.test(value)
    || /^(?:גימור|מאפיינים(?: מיוחדים)?|מערכות|דגם(?: ברקוד)?|מבנה(?: תא(?: הקירור| ההקפאה)?| מיוחד)?|נפח תא(?: המזון| ההקפאה| האפייה)?|אביזרים(?: נלווים)?|תכונות|מנגנונים(?: מיוחדים)?|מיוחדים|מולטימדיה|כניסות|לחצנים וכפתורים|סוגי התוכניות|תיאור כללי|פונקציות|כיריים|תאים|מנוע|מבנה|מיוחד|גוף|אוטומטי|עוצמה|הקירור|ההקפאה|התמונה|הדחה|הספק(?: מנוע|י המבערים| מקסימלי)?|קיבולת כביסה|מהירות סחיטה|מצב כיבוי תאורה|צג וכפתורים|מגירות ומידוף|טכנולוגיית קירור|נפח תא|מקסימלית|תאורה|התקנה|שחור|לבן|שמנת|נירוסטה|כסוף|אפור|אדום|כחול|ירוק|זכוכית(?: שחורה| לבנה)?|שחורה|לבנה)$/i.test(value)
    || /^(?:לסאונד|לעיצוב|לבטיחות|של הקור|בתוך|ופונקציות|ומידוף|וקערות|המאפשר|הכולל|המפסיקים|מקררת את|לא יפעלו|באמצעות|לאחר סיום|ממצב|צורכים|עומד בקו|זמזם|פתיחה צד|תמונה גבוהים|גבוהים במיוחד|המשתמש|לפקודות|מנגנון נעילת|שווה ואחידה)/i.test(value);
}

function modelKey(value) {
  return clean(value).toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");
}

function sanitizeTechnicalAttributes(value, name) {
  const attributes = value && typeof value === "object" ? value : {};
  const dimensionsCm = numericRecord(attributes.dimensionsCm, ["widthCm", "heightCm", "depthCm"]);
  const capacities = numericRecord(attributes.capacities, ["totalLiters", "fridgeLiters", "freezerLiters", "ovenLiters", "bottleCount", "placeSettings", "washKg"]);
  const performance = numericRecord(attributes.performance, ["powerW", "programCount", "noiseDb", "waterConsumptionLiters", "spinRpm", "airflowM3h", "screenSizeInches"]);
  const energyRating = cleanEnergyRating(attributes.performance?.energyRating);
  const temperatureRangeC = numericRange(attributes.performance?.temperatureRangeC);
  const resolutionPixels = numericRecord(attributes.performance?.resolutionPixels, ["width", "height"]);
  const displayDimensionsMm = {
    withoutStand: numericRecord(attributes.displayDimensionsMm?.withoutStand, ["widthMm", "heightMm", "depthMm"]),
    withStand: numericRecord(attributes.displayDimensionsMm?.withStand, ["widthMm", "heightMm", "depthMm"]),
  };
  const category = clean(attributes.classification?.category) || inferCategory(name);
  const colors = [...new Set((Array.isArray(attributes.colors) ? attributes.colors : []).map(clean).filter(Boolean))];
  const barcodes = [...new Set((Array.isArray(attributes.barcodes) ? attributes.barcodes : [])
    .map(clean)
    .filter((barcode) => /^\d{10,14}$/.test(barcode)))];
  const facts = [...new Set([
    ...(Array.isArray(attributes.features) ? attributes.features : []),
    ...(Array.isArray(attributes.sourceFacts) ? attributes.sourceFacts : []),
  ].map(cleanTechnicalFact).filter(Boolean))].slice(0, 80);
  return {
    category,
    colors,
    dimensionsCm,
    ...(Object.keys(capacities).length ? { capacities } : {}),
    ...(Object.keys(performance).length || energyRating || temperatureRangeC || Object.keys(resolutionPixels).length
      ? { performance: { ...performance, ...(energyRating ? { energyRating } : {}), ...(temperatureRangeC ? { temperatureRangeC } : {}), ...(Object.keys(resolutionPixels).length ? { resolutionPixels } : {}) } }
      : {}),
    ...(Object.keys(displayDimensionsMm.withoutStand).length || Object.keys(displayDimensionsMm.withStand).length ? { displayDimensionsMm } : {}),
    ...(isFiniteNumber(attributes.weightKg) ? { weightKg: Number(attributes.weightKg) } : {}),
    ...(barcodes.length ? { barcodes } : {}),
    facts,
  };
}

function numericRecord(value, keys) {
  const result = {};
  for (const key of keys) {
    if (isFiniteNumber(value?.[key])) result[key] = Number(value[key]);
  }
  return result;
}

function numericRange(value) {
  if (!isFiniteNumber(value?.min) || !isFiniteNumber(value?.max)) return null;
  return { min: Number(value.min), max: Number(value.max) };
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function inferCategory(name) {
  const categories = [
    ["טלוויזיה", ["TV", "טלוויז"]],
    ["מיקרוגל", ["מיקרוגל"]],
    ["תנור", ["תנור"]],
    ["קולט אדים", ["קולט"]],
    ["כיריים", ["כיריים"]],
    ["מדיח כלים", ["מדיח"]],
    ["מכונת כביסה", ["מכונת כביסה", "מ.כביסה"]],
    ["מייבש כביסה", ["מייבש"]],
    ["מקרר", ["מקרר"]],
    ["מקפיא", ["מקפיא"]],
  ];
  const lowered = clean(name).toLocaleLowerCase("he-IL");
  return categories.find(([, terms]) => terms.some((term) => lowered.includes(term.toLocaleLowerCase("he-IL"))))?.[0] || "אחר";
}

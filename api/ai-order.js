import { get } from "@vercel/blob";
import { isAuthorized } from "./_auth.js";

const STATE_PATH = "price-search/state.json";
const MAX_INSTRUCTION_LENGTH = 2_000;
const MAX_ORDER_QUANTITY = 1_000;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "32kb",
    },
  },
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  const apiKey = getEnvValue("OPENAI_API_KEY");
  if (!apiKey) {
    sendJson(response, 503, { error: "ai_not_configured" });
    return;
  }
  if (!getEnvValue("BLOB_READ_WRITE_TOKEN") && !getEnvValue("VERCEL_OIDC_TOKEN")) {
    sendJson(response, 503, { error: "cloud_storage_not_configured" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const instruction = cleanString(body.instruction).slice(0, MAX_INSTRUCTION_LENGTH);
    if (instruction.length < 4) {
      sendJson(response, 400, { error: "invalid_instruction" });
      return;
    }

    const state = await readCloudState();
    const catalog = normalizeCatalog(state.products);
    const customers = normalizeCustomers(state.customers);
    const reservations = normalizeReservations(state.reservations);
    if (!catalog.length) {
      sendJson(response, 422, { error: "empty_catalog" });
      return;
    }

    const intent = await extractOrderIntent({ instruction, catalog, customers, apiKey });
    const proposal = createOrderProposal({ intent, catalog, customers, reservations });
    sendJson(response, 200, { ok: true, proposal });
  } catch (error) {
    console.error("AI order proposal failed", error);
    const statusCode = error?.code === "state_read_failed" ? 503 : error?.code === "ai_provider_error" ? 502 : 500;
    sendJson(response, statusCode, { error: error?.code || "ai_provider_error" });
  }
}

async function readCloudState() {
  const stored = await get(STATE_PATH, {
    access: "private",
    useCache: false,
    ...getBlobAuthOptions(),
  });
  if (!stored || stored.statusCode !== 200 || !stored.stream) {
    const error = new Error("Cloud state not found");
    error.code = "state_read_failed";
    throw error;
  }
  try {
    return JSON.parse(await streamToText(stored.stream));
  } catch (cause) {
    const error = new Error("Cloud state is invalid");
    error.code = "state_read_failed";
    error.cause = cause;
    throw error;
  }
}

async function extractOrderIntent({ instruction, catalog, customers, apiKey }) {
  const catalogText = catalog.map((product) => `${product.sku} | ${product.description}`).join("\n");
  const customerText = customers.map((customer) => `${customer.name}${customer.code ? ` | ${customer.code}` : ""}`).join("\n");
  const prompt = [
    `בקשת המשתמש: ${instruction}`,
    "",
    "לקוחות קיימים:",
    customerText || "אין לקוחות",
    "",
    "קטלוג מוצרים (מק״ט | תיאור):",
    catalogText,
  ].join("\n");

  const providerResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getEnvValue("OPENAI_MODEL") || "gpt-5",
      store: false,
      instructions: [
        "אתה עוזר הזמנות למערכת ישראלית בעברית.",
        "חלץ רק את שם/כינוי הלקוח ואת פריטי ההזמנה והכמויות.",
        "בחר לכל מוצר מק״ט מדויק מתוך הקטלוג בלבד. לעולם אל תמציא לקוח, מוצר, מק״ט או כמות.",
        "כאשר יש יותר ממוצר אחד שמתאים לאותו תיאור ואין מספיק מידע לבחור בבטחה, סמן needsClarification=true והסבר בקצרה מה חסר.",
        "אין לחשב מחירים, אין לשמור הזמנה, אין לשלוח הודעות, ואין להחליט על שריונים. המערכת תבצע זאת בעצמה.",
      ].join(" "),
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "order_intent",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["customerQuery", "items", "needsClarification", "clarification"],
            properties: {
              customerQuery: { type: "string" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["productQuery", "sku", "quantity"],
                  properties: {
                    productQuery: { type: "string" },
                    sku: { type: "string" },
                    quantity: { type: "number" },
                  },
                },
              },
              needsClarification: { type: "boolean" },
              clarification: { type: "string" },
            },
          },
        },
      },
    }),
  });

  const result = await providerResponse.json().catch(() => null);
  if (!providerResponse.ok || !result) {
    const error = new Error("OpenAI request failed");
    error.code = "ai_provider_error";
    throw error;
  }

  const outputText = cleanString(result.output_text || extractOutputText(result.output));
  if (!outputText) {
    const error = new Error("OpenAI response did not include text");
    error.code = "ai_provider_error";
    throw error;
  }
  try {
    return JSON.parse(outputText);
  } catch (cause) {
    const error = new Error("OpenAI response was not valid JSON");
    error.code = "ai_provider_error";
    error.cause = cause;
    throw error;
  }
}

function createOrderProposal({ intent, catalog, customers, reservations }) {
  const customerQuery = cleanString(intent?.customerQuery);
  const customer = resolveCustomer(customerQuery, customers);
  const itemsBySku = new Map();
  const unmatched = [];

  const rawItems = Array.isArray(intent?.items) ? intent.items : [];
  rawItems.forEach((rawItem) => {
    const quantity = clampQuantity(rawItem?.quantity);
    const productQuery = cleanString(rawItem?.productQuery || rawItem?.sku);
    const product = resolveProduct(cleanString(rawItem?.sku), productQuery, catalog);
    if (!quantity || !product) {
      unmatched.push({ query: productQuery || "מוצר ללא תיאור", quantity: quantity || 0, reason: "not_found" });
      return;
    }
    const existing = itemsBySku.get(product.skuKey);
    if (existing) {
      existing.quantity += quantity;
    } else {
      itemsBySku.set(product.skuKey, { product, quantity });
    }
  });

  const items = [...itemsBySku.values()].map(({ product, quantity }) => {
    const reservation = customer
      ? reservations.find((item) => item.customerId === customer.id && item.skuKey === product.skuKey)
      : null;
    const reservationAvailable = Math.max(0, toNonNegativeInteger(reservation?.quantity));
    const reservedQuantity = Math.min(quantity, reservationAvailable);
    const paidQuantity = Math.max(0, quantity - reservedQuantity);
    const unitPrice = roundMoney(product.price);
    return {
      skuKey: product.skuKey,
      sku: product.sku,
      description: product.description,
      quantity,
      reservationAvailable,
      reservedQuantity,
      reservationRemainingAfter: Math.max(0, reservationAvailable - reservedQuantity),
      paidQuantity,
      unitPrice,
      pricedTotal: roundMoney(paidQuantity * unitPrice),
    };
  });

  const clarification = cleanString(intent?.clarification) || buildClarification({ customerQuery, customer, items, unmatched });
  const ready = Boolean(customer && items.length && !unmatched.length && !intent?.needsClarification);

  return {
    ready,
    customer: customer ? { id: customer.id, name: customer.name } : null,
    customerQuery,
    items,
    unmatched,
    clarification,
    total: roundMoney(items.reduce((sum, item) => sum + item.pricedTotal, 0)),
  };
}

function buildClarification({ customerQuery, customer, items, unmatched }) {
  if (!customer) return customerQuery ? `לא מצאתי לקוח בשם „${customerQuery}”.` : "לא זוהה לקוח לבקשה.";
  if (unmatched.length) return "חלק מהמוצרים לא זוהו בוודאות.";
  if (!items.length) return "לא זוהו פריטים להזמנה.";
  return "";
}

function resolveCustomer(query, customers) {
  const normalized = normalizeIdentity(query);
  if (!normalized) return null;
  const exact = customers.find((customer) => normalizeIdentity(customer.name) === normalized);
  if (exact) return exact;
  const candidates = customers
    .map((customer) => ({ customer, score: scoreTextMatch(normalized, normalizeIdentity(customer.name)) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name, "he"));
  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0].score <= candidates[1].score + 1) return null;
  return candidates[0].customer;
}

function resolveProduct(sku, query, catalog) {
  const normalizedSku = normalizeSku(sku);
  if (normalizedSku) {
    const exact = catalog.find((product) => normalizeSku(product.sku) === normalizedSku);
    if (exact) return exact;
  }

  const normalizedQuery = normalizeIdentity(query);
  if (!normalizedQuery) return null;
  const candidates = catalog
    .map((product) => {
      const productText = normalizeIdentity(`${product.sku} ${product.description}`);
      return { product, score: scoreTextMatch(normalizedQuery, productText) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.product.sku.localeCompare(b.product.sku));
  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0].score <= candidates[1].score + 1) return null;
  return candidates[0].product;
}

function scoreTextMatch(query, target) {
  if (!query || !target) return 0;
  if (target === query) return 1000;
  let score = target.includes(query) ? 40 : 0;
  const tokens = query.match(/[\p{L}\p{N}]+/gu) || [];
  tokens.forEach((token) => {
    if (!target.includes(token)) return;
    score += /^\d+$/.test(token) ? 8 : token.length >= 2 ? 4 : 1;
  });
  return score;
}

function normalizeCatalog(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const sku = cleanString(item?.sku);
      const description = cleanString(item?.description);
      const skuKey = normalizeSku(sku);
      if (!skuKey || !description) return null;
      return { skuKey, sku, description, price: Math.max(0, toNumber(item?.price)) };
    })
    .filter(Boolean);
}

function normalizeCustomers(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const id = cleanString(item?.id);
      const name = cleanString(typeof item === "string" ? item : item?.name);
      if (!id || !name) return null;
      return { id, name, code: cleanString(item?.code) };
    })
    .filter(Boolean);
}

function normalizeReservations(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const customerId = cleanString(item?.customerId);
      const skuKey = normalizeSku(item?.skuKey || item?.sku);
      if (!customerId || !skuKey) return null;
      return { customerId, skuKey, quantity: toNonNegativeInteger(item?.quantity) };
    })
    .filter(Boolean);
}

function extractOutputText(output) {
  if (!Array.isArray(output)) return "";
  return output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((content) => content?.text || content?.value || "")
    .find((text) => cleanString(text)) || "";
}

function normalizeIdentity(value) {
  return cleanString(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeSku(value) {
  return cleanString(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function clampQuantity(value) {
  const quantity = Math.floor(Number(value));
  return Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, MAX_ORDER_QUANTITY) : 0;
}

function toNonNegativeInteger(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function getBlobAuthOptions() {
  const token = getEnvValue("BLOB_READ_WRITE_TOKEN");
  if (token) return { token };
  const oidcToken = getEnvValue("VERCEL_OIDC_TOKEN");
  return oidcToken ? { oidcToken } : {};
}

function getEnvValue(name) {
  return String(process.env[name] || "").replace(/^["']|["']$/g, "");
}

function cleanString(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function readJsonBody(request) {
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString("utf8") || "{}");
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  if (request.body && typeof request.body === "object") return request.body;
  const body = await new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => resolve(raw));
    request.on("error", reject);
  });
  return JSON.parse(body || "{}");
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

function sendJson(response, statusCode, data) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

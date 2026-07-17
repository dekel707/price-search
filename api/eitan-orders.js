import { isAuthorized } from "./_auth.js";
import { hasDatabaseStorageCredentials, readDatabaseState, saveDatabaseState } from "./_database.js";
import { getOrderReportDateForDraft } from "../src/order-schedule.js";

const DEFAULT_PORTAL_URL = "https://price-search-eitan-portal.vercel.app";
const REQUEST_TIMEOUT_MS = 15_000;

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method === "OPTIONS") {
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.statusCode = 204;
    response.end();
    return;
  }
  if (!isAuthorized(request)) return sendJson(response, 401, { error: "unauthorized" });

  const config = getConfig();
  if (!config.bridgeSecret) return sendJson(response, 503, { error: "eitan_portal_bridge_not_configured" });

  try {
    if (request.method === "GET") return forward(response, await partnerRequest(config, "?resource=owner-queue"));
    if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });

    const body = await readJsonBody(request);
    if (body.action !== "approve" || !cleanText(body.orderId, 100)) return sendJson(response, 400, { error: "invalid_action" });

    const orderId = cleanText(body.orderId, 100);
    const claimed = await partnerRequest(config, "?action=owner-queue-claim", {
      method: "POST",
      body: JSON.stringify({ orderId }),
    });
    if (!claimed.ok) return forward(response, claimed);

    const claimPayload = await claimed.json().catch(() => ({}));
    const partnerOrder = claimPayload.order;
    if (!partnerOrder?.id) return sendJson(response, 502, { error: "invalid_partner_order" });

    let mainResult;
    try {
      mainResult = await saveApprovedPartnerOrder(partnerOrder);
    } catch (error) {
      await partnerRequest(config, "?action=owner-queue-release", {
        method: "POST",
        body: JSON.stringify({ orderId }),
      }).catch(() => undefined);
      throw error;
    }

    const completed = await partnerRequest(config, "?action=owner-queue-complete", {
      method: "POST",
      body: JSON.stringify({ orderId }),
    });
    if (!completed.ok) {
      // The main order is already safely stored. Keeping the partner order in
      // "processing" is deliberate: retrying is idempotent and completes it.
      return sendJson(response, 202, { ok: true, pendingPartnerCompletion: true, ...mainResult });
    }
    return sendJson(response, 200, { ok: true, ...mainResult });
  } catch (error) {
    console.error("eitan_orders_bridge_failed", error);
    return sendJson(response, error.statusCode || 502, { error: error.message || "eitan_portal_unavailable" });
  }
}

function getConfig() {
  return {
    bridgeSecret: process.env.EITAN_PORTAL_BRIDGE_SECRET || "",
    portalUrl: (process.env.EITAN_PORTAL_URL || DEFAULT_PORTAL_URL).replace(/\/$/, ""),
  };
}

async function partnerRequest(config, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${config.portalUrl}/api/portal${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "x-owner-bridge": config.bridgeSecret,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function saveApprovedPartnerOrder(partnerOrder) {
  if (!hasDatabaseStorageCredentials()) {
    const error = new Error("main_database_not_configured");
    error.statusCode = 503;
    throw error;
  }
  const current = await readDatabaseState();
  if (!current?.state) throw new Error("main_state_unavailable");

  const sourceId = `eitan-${cleanText(partnerOrder.id, 100)}`;
  const existing = (current.state.orders || []).find((order) => order.id === sourceId);
  if (existing) return { orderId: existing.id, alreadyImported: true, reportDate: existing.reportDate };

  const state = structuredClone(current.state);
  const customerId = cleanText(partnerOrder.mainCustomerId, 180);
  const customer = (state.customers || []).find((item) => cleanText(item.id, 180) === customerId);
  if (!customer) {
    const error = new Error("main_customer_not_found");
    error.statusCode = 422;
    throw error;
  }

  const now = new Date();
  const createdAt = now.toISOString();
  const products = Array.isArray(state.products) ? state.products : [];
  const reservations = Array.isArray(state.reservations) ? state.reservations : [];
  const nextItems = [];
  const reservationAdjustments = [];

  for (const submittedLine of Array.isArray(partnerOrder.items) ? partnerOrder.items : []) {
    const skuKey = getSkuKey(submittedLine.skuKey || submittedLine.model);
    const product = products.find((item) => getSkuKey(item.sku || item.skuKey) === skuKey);
    const quantity = positiveQuantity(submittedLine.quantity);
    if (!product || !quantity) {
      const error = new Error("main_product_not_found");
      error.statusCode = 422;
      throw error;
    }
    const price = money(submittedLine.unitPrice, money(product.price, 0));
    const requestedReservation = submittedLine.fromReservation ? Math.min(quantity, nonNegativeQuantity(submittedLine.reservationQuantity)) : 0;
    const reservation = reservations.find((item) => cleanText(item.customerId, 180) === customer.id && getSkuKey(item.skuKey || item.sku) === skuKey);
    const availableReservation = nonNegativeQuantity(reservation?.quantity);
    const actualReservation = Math.min(requestedReservation, availableReservation);
    const paidQuantity = quantity - actualReservation;

    if (actualReservation) {
      nextItems.push(createMainLine({ sourceId, skuKey, product, quantity: actualReservation, price, fromReservation: true }));
      reservationAdjustments.push({ reservation, nextQuantity: availableReservation - actualReservation });
    }
    if (paidQuantity) nextItems.push(createMainLine({ sourceId, skuKey, product, quantity: paidQuantity, price, fromReservation: false }));
  }
  if (!nextItems.length) {
    const error = new Error("partner_order_has_no_valid_items");
    error.statusCode = 422;
    throw error;
  }

  reservationAdjustments.forEach(({ reservation, nextQuantity }) => {
    if (reservation) {
      reservation.quantity = nextQuantity;
      reservation.updatedAt = createdAt;
    }
  });

  const order = {
    id: sourceId,
    createdAt,
    updatedAt: createdAt,
    completedAt: "",
    // Classification is deliberately calculated at owner approval time, as
    // requested: the order joins today's/tomorrow's workflow only once you approve it.
    reportDate: getOrderReportDateForDraft(createdAt, false, false),
    customerId: customer.id,
    customerName: cleanText(customer.name, 180),
    customerCode: cleanText(customer.code, 80),
    customerPhone: cleanText(customer.phone, 80),
    orderType: "delivery",
    items: nextItems,
    total: roundMoney(nextItems.reduce((sum, line) => sum + line.lineTotal, 0)),
  };
  state.orders = [order, ...(state.orders || [])];
  state.reservations = reservations;
  state.lastPrices = { ...(state.lastPrices || {}) };
  nextItems.filter((line) => !line.fromReservation).forEach((line) => {
    state.lastPrices[line.skuKey] = { price: line.unitPrice, savedAt: createdAt };
  });
  state.updatedAt = createdAt;

  const saved = await saveDatabaseState(state, current.version, { action: "eitan-order-approval" });
  if (saved.conflict || saved.missing || saved.blockedOrderRemovals) {
    const error = new Error("main_state_changed_retry_approval");
    error.statusCode = 409;
    throw error;
  }
  return {
    orderId: order.id,
    reportDate: order.reportDate,
    reservationUnits: nextItems.filter((item) => item.fromReservation).reduce((sum, item) => sum + item.quantity, 0),
    paidUnits: nextItems.filter((item) => !item.fromReservation).reduce((sum, item) => sum + item.quantity, 0),
    recoveredConcurrentSave: Boolean(saved.recovered),
  };
}

function createMainLine({ sourceId, skuKey, product, quantity, price, fromReservation }) {
  const unitPrice = fromReservation ? 0 : price;
  return {
    lineKey: `${sourceId}-${skuKey}-${fromReservation ? "reservation" : "paid"}`,
    skuKey,
    sku: cleanText(product.sku || skuKey, 120),
    description: cleanText(product.description || product.name || product.sku || skuKey, 240),
    listPrice: price,
    unitPrice,
    priceSource: fromReservation ? "reservation" : "list",
    bonusType: "",
    quantity,
    lineTotal: roundMoney(quantity * unitPrice),
    fromReservation,
  };
}

async function forward(response, upstream) {
  const payload = await upstream.json().catch(() => ({ error: "invalid_upstream_response" }));
  return sendJson(response, upstream.status, payload);
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function getSkuKey(value) { return cleanText(value, 180).toLocaleUpperCase("en-US"); }
function cleanText(value, max = 180) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, max); }
function positiveQuantity(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0; }
function nonNegativeQuantity(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0; }
function money(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? roundMoney(number) : roundMoney(fallback); }
function roundMoney(value) { return Math.round((Number(value) || 0) * 100) / 100; }

function sendJson(response, status, body) {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

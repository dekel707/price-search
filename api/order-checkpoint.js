import { isAuthorized } from "./_auth.js";
import { mergeRecentMissingOrders } from "./_order-conflict-recovery.js";
import { readPartnerMainState, savePartnerMainState } from "./_partner-main-state.js";

const MAX_SAVE_ATTEMPTS = 4;

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const order = normalizeCheckpointOrder(body?.order);
    const customer = normalizeCheckpointCustomer(body?.customer, order);

    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      const current = await readPartnerMainState();
      const liveOrders = Array.isArray(current.state?.orders) ? current.state.orders : [];
      if (liveOrders.some((entry) => String(entry?.id || "") === order.id)) {
        response.setHeader("X-State-Version", current.version || "");
        sendJson(response, 200, { ok: true, alreadySaved: true, orderId: order.id, stateVersion: current.version || "" });
        return;
      }

      const attemptedState = structuredClone(current.state || {});
      attemptedState.orders = [order, ...liveOrders];
      if (customer) {
        const customers = Array.isArray(attemptedState.customers) ? attemptedState.customers : [];
        const customerExists = customers.some((entry) =>
          String(entry?.id || "") === customer.id || cleanName(entry?.name) === cleanName(customer.name),
        );
        if (!customerExists) attemptedState.customers = [...customers, customer];
      }

      const recovery = mergeRecentMissingOrders(current.state || {}, attemptedState);
      if (!recovery.recovered) throw stateError("order_checkpoint_rejected", 400);

      try {
        const saved = await savePartnerMainState(current, recovery.state, { action: "order-checkpoint" });
        const stateVersion = saved.stateVersion || saved.current?.version || "";
        response.setHeader("X-State-Version", stateVersion);
        sendJson(response, 200, { ok: true, orderId: order.id, stateVersion });
        return;
      } catch (error) {
        if (error?.statusCode === 409 && attempt + 1 < MAX_SAVE_ATTEMPTS) continue;
        throw error;
      }
    }

    throw stateError("order_checkpoint_conflict", 409);
  } catch (error) {
    console.error(error);
    sendJson(response, Number(error?.statusCode) || 500, { error: error?.message || "order_checkpoint_failed" });
  }
}

function normalizeCheckpointOrder(value) {
  const order = value && typeof value === "object" ? structuredClone(value) : null;
  const id = String(order?.id || "").trim();
  const createdAt = new Date(order?.createdAt || 0);
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!id || !Number.isFinite(createdAt.getTime()) || !items.length) {
    throw stateError("invalid_order_checkpoint", 400);
  }
  if (Math.abs(Date.now() - createdAt.getTime()) > 48 * 60 * 60 * 1000) {
    throw stateError("stale_order_checkpoint", 400);
  }
  return { ...order, id, createdAt: createdAt.toISOString() };
}

function normalizeCheckpointCustomer(value, order) {
  const customer = value && typeof value === "object" ? structuredClone(value) : null;
  const id = String(customer?.id || order?.customerId || "").trim();
  const name = String(customer?.name || order?.customerName || "").trim();
  return id && name ? { ...customer, id, name } : null;
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

async function readJsonBody(request) {
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString("utf8") || "{}");
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  if (request.body && typeof request.body === "object") return request.body;
  const raw = await new Promise((resolve, reject) => {
    let text = "";
    request.on("data", (chunk) => { text += chunk; });
    request.on("end", () => resolve(text));
    request.on("error", reject);
  });
  return JSON.parse(raw || "{}");
}

function stateError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendJson(response, statusCode, data) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

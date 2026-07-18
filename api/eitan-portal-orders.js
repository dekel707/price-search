import crypto from "node:crypto";
import { deletePartnerOrderFromMain, savePartnerOrderIntoMain, updatePartnerOrderInMain } from "./eitan-orders.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
  if (!isPortalAuthorized(request)) return sendJson(response, 401, { error: "unauthorized_partner_order" });
  try {
    const body = await readJsonBody(request);
    if (!body?.order?.id) return sendJson(response, 400, { error: "invalid_partner_order" });
    const action = String(body.action || "create").trim();
    if (!["create", "update", "delete"].includes(action)) return sendJson(response, 400, { error: "invalid_partner_order_action" });
    const result = action === "delete"
      ? await deletePartnerOrderFromMain(body.order.id)
      : action === "update"
        ? await updatePartnerOrderInMain(body.order)
        : await savePartnerOrderIntoMain(body.order, { timeBasis: "submitted" });
    return sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    console.error("eitan_portal_order_import_failed", error);
    return sendJson(response, error.statusCode || 502, { error: error.message || "main_order_import_failed" });
  }
}

function isPortalAuthorized(request) {
  const expected = String(process.env.EITAN_PORTAL_ORDER_SECRET || "");
  const actual = String(request.headers["x-eitan-order"] || "");
  return Boolean(expected) && expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, body) { response.statusCode = status; response.end(JSON.stringify(body)); }

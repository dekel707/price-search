import crypto from "node:crypto";
import { readPartnerMainState } from "./_partner-main-state.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method !== "GET") return sendJson(response, 405, { error: "method_not_allowed" });
  if (!isPortalAuthorized(request)) return sendJson(response, 401, { error: "unauthorized_portal_sync" });
  try {
    const current = await readPartnerMainState();
    if (!current?.state) return sendJson(response, 503, { error: "main_state_unavailable" });
    const state = current.state;
    // This is intentionally a narrow, read-only projection. Eitan receives
    // only the working price list, current stock, customers and reservations
    // needed for his permitted ordering workflow. It never exposes the
    // main order history, settings, notes, backups or storage credentials.
    return sendJson(response, 200, {
      updatedAt: current.updatedAt,
      products: (state.products || []).map((product) => ({
        sku: text(product.sku, 120),
        description: text(product.description, 240),
        price: money(product.price),
        stockQuantity: optionalQuantity(product.stockQuantity ?? product.stock ?? product.inventory),
      })).filter((product) => product.sku && product.description),
      customers: (state.customers || []).map((customer) => ({
        id: text(customer.id, 180),
        code: text(customer.code, 80),
        name: text(customer.name, 180),
        phone: text(customer.phone, 80),
      })).filter((customer) => customer.id && customer.name),
      reservations: (state.reservations || []).map((reservation) => ({
        id: text(reservation.id, 180),
        customerId: text(reservation.customerId, 180),
        customerName: text(reservation.customerName, 180),
        skuKey: text(reservation.skuKey || reservation.sku, 180),
        sku: text(reservation.sku, 120),
        description: text(reservation.description, 240),
        quantity: quantity(reservation.quantity),
        updatedAt: text(reservation.updatedAt, 80),
      })).filter((reservation) => reservation.customerId && reservation.skuKey),
    });
  } catch (error) {
    console.error("eitan_live_data_failed", error);
    return sendJson(response, 502, { error: "main_data_unavailable" });
  }
}

function isPortalAuthorized(request) {
  const expected = String(process.env.EITAN_PORTAL_SYNC_SECRET || "");
  const actual = String(request.headers["x-eitan-sync"] || "");
  return Boolean(expected) && expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
function text(value, max) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, max); }
function money(value) { const number = Number(value); return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0; }
function quantity(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0; }
function optionalQuantity(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null; }
function sendJson(response, status, body) { response.statusCode = status; response.end(JSON.stringify(body)); }

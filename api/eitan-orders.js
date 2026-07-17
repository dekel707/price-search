import { isAuthorized } from "./_auth.js";

const DEFAULT_PORTAL_URL = "https://price-search-eitan-portal.vercel.app";

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
  const bridgeSecret = process.env.EITAN_PORTAL_BRIDGE_SECRET || "";
  const portalUrl = (process.env.EITAN_PORTAL_URL || DEFAULT_PORTAL_URL).replace(/\/$/, "");
  if (!bridgeSecret) return sendJson(response, 503, { error: "eitan_portal_bridge_not_configured" });

  try {
    if (request.method === "GET") {
      const upstream = await fetch(`${portalUrl}/api/portal?resource=owner-queue`, {
        headers: { "x-owner-bridge": bridgeSecret, Accept: "application/json" },
      });
      return forward(response, upstream);
    }
    if (request.method === "POST") {
      const body = await readJsonBody(request);
      if (body.action !== "approve" || !body.orderId) return sendJson(response, 400, { error: "invalid_action" });
      const upstream = await fetch(`${portalUrl}/api/portal?action=owner-queue-approve`, {
        method: "POST",
        headers: { "x-owner-bridge": bridgeSecret, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ orderId: String(body.orderId) }),
      });
      return forward(response, upstream);
    }
    return sendJson(response, 405, { error: "method_not_allowed" });
  } catch (error) {
    console.error("eitan_orders_bridge_failed", error);
    return sendJson(response, 502, { error: "eitan_portal_unavailable" });
  }
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

function sendJson(response, status, body) {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

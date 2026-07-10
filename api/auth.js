import { clearAuthCookie, createAuthCookie, isAuthorized, isValidPin } from "./_auth.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method === "GET") {
    sendJson(response, 200, { authenticated: isAuthorized(request) });
    return;
  }

  if (request.method === "POST") {
    const body = await readJsonBody(request);
    if (!isValidPin(body.pin)) {
      sendJson(response, 401, { error: "invalid_pin" });
      return;
    }

    response.setHeader("Set-Cookie", createAuthCookie(Boolean(body.remember)));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "DELETE") {
    response.setHeader("Set-Cookie", clearAuthCookie());
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 405, { error: "method_not_allowed" });
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

function sendJson(response, statusCode, data) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

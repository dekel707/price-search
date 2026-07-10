import crypto from "node:crypto";

const AUTH_COOKIE = "price_search_auth";
const ACCESS_PIN = "1221";
const SESSION_SECONDS = 60 * 60 * 12;
const REMEMBER_SECONDS = 60 * 60 * 24 * 30;

export function isAuthorized(request) {
  const rawCookie = getCookie(request, AUTH_COOKIE);
  if (!rawCookie) return false;

  const [payload, signature] = rawCookie.split(".");
  if (!payload || !signature || sign(payload) !== signature) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function isValidPin(value) {
  return safeEqual(String(value || ""), getAccessPin());
}

export function createAuthCookie(remember) {
  const maxAge = remember ? REMEMBER_SECONDS : SESSION_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iat: now,
      exp: now + maxAge,
      remember: Boolean(remember),
    }),
  ).toString("base64url");

  return serializeCookie(AUTH_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    maxAge,
    sameSite: "Lax",
    secure: isSecureRuntime(),
    path: "/",
  });
}

export function clearAuthCookie() {
  return serializeCookie(AUTH_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    sameSite: "Lax",
    secure: isSecureRuntime(),
    path: "/",
  });
}

function getAccessPin() {
  return getEnvValue("ACCESS_PIN") || ACCESS_PIN;
}

function getSecret() {
  return getEnvValue("AUTH_SECRET") || `price-search-auth-${getAccessPin()}`;
}

function sign(value) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getCookie(request, name) {
  const cookie = request.headers?.cookie || "";
  const prefix = `${name}=`;
  return (
    cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) || ""
  );
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${value}`, `Path=${options.path || "/"}`, `SameSite=${options.sameSite || "Lax"}`];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  return parts.join("; ");
}

function isSecureRuntime() {
  return Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");
}

function getEnvValue(name) {
  return String(process.env[name] || "").replace(/^["']|["']$/g, "");
}

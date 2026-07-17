import crypto from "node:crypto";
import postgres from "postgres";

const COOKIE_NAME = "price_search_partner_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const DEFAULT_CATALOG_URL = "https://price-search-teal.vercel.app/api/dealer-catalog";
let sqlClient;
let schemaReady;

function sendJson(response, status, body) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function getConfig() {
  const config = {
    databaseUrl: process.env.TEAM_PORTAL_DATABASE_URL,
    ownerPin: process.env.TEAM_PORTAL_OWNER_PIN,
    eitanPin: process.env.TEAM_PORTAL_EITAN_PIN,
    authSecret: process.env.TEAM_PORTAL_AUTH_SECRET,
    cronSecret: process.env.TEAM_PORTAL_CRON_SECRET,
    catalogUrl: process.env.TEAM_PORTAL_CATALOG_URL || DEFAULT_CATALOG_URL,
  };
  if (!config.databaseUrl || !config.ownerPin || !config.eitanPin || !config.authSecret || !config.cronSecret) {
    throw new Error("partner_portal_not_configured");
  }
  return config;
}

function getSql(config) {
  if (!sqlClient) {
    sqlClient = postgres(config.databaseUrl, {
      ssl: "require",
      max: 2,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sqlClient;
}

async function ensureSchema(sql) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS partner_customers (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS partner_reservations (
        id UUID PRIMARY KEY,
        customer_id UUID NOT NULL REFERENCES partner_customers(id),
        product_model TEXT NOT NULL,
        initial_quantity NUMERIC(12, 2) NOT NULL CHECK (initial_quantity >= 0),
        remaining_quantity NUMERIC(12, 2) NOT NULL CHECK (remaining_quantity >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS partner_reservations_lookup ON partner_reservations(customer_id, product_model, created_at)`;
      await sql`CREATE TABLE IF NOT EXISTS partner_aging (
        id UUID PRIMARY KEY,
        customer_id UUID NOT NULL REFERENCES partner_customers(id),
        outstanding_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS partner_orders (
        id UUID PRIMARY KEY,
        customer_id UUID NOT NULL REFERENCES partner_customers(id),
        created_by TEXT NOT NULL CHECK (created_by IN ('owner', 'eitan')),
        status TEXT NOT NULL DEFAULT 'pending_owner_approval' CHECK (status IN ('pending_owner_approval', 'approved', 'cancelled')),
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS partner_orders_created_by ON partner_orders(created_by, created_at DESC)`;
      await sql`CREATE TABLE IF NOT EXISTS partner_order_items (
        id UUID PRIMARY KEY,
        order_id UUID NOT NULL REFERENCES partner_orders(id) ON DELETE CASCADE,
        product_model TEXT NOT NULL,
        product_name TEXT NOT NULL,
        quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
        reservation_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (reservation_quantity >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS partner_reservation_ledger (
        id UUID PRIMARY KEY,
        reservation_id UUID NOT NULL REFERENCES partner_reservations(id),
        order_id UUID REFERENCES partner_orders(id),
        quantity_delta NUMERIC(12, 2) NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL CHECK (actor IN ('owner', 'eitan')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS partner_audit_events (
        id UUID PRIMARY KEY,
        actor TEXT NOT NULL,
        event_type TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS partner_backups (
        id UUID PRIMARY KEY,
        reason TEXT NOT NULL,
        snapshot JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS partner_backups_created_at ON partner_backups(created_at DESC)`;
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").map((value) => value.trim()).filter(Boolean).map((value) => {
    const index = value.indexOf("=");
    return [value.slice(0, index), decodeURIComponent(value.slice(index + 1))];
  }));
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createSession(role, config) {
  const payload = Buffer.from(JSON.stringify({ role, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${sign(payload, config.authSecret)}`;
}

function readSession(request, config) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload, config.authSecret);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!['owner', 'eitan'].includes(session.role) || !Number.isFinite(session.expiresAt) || session.expiresAt < Date.now()) return null;
    return { role: session.role };
  } catch {
    return null;
  }
}

function setSessionCookie(response, token) {
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`);
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function requireRole(session, ...roles) {
  if (!session || !roles.includes(session.role)) {
    const error = new Error("unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

function normaliseQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) throw new Error("invalid_quantity");
  return Math.round(quantity * 100) / 100;
}

function cleanText(value, max = 180) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function asNumber(value) {
  return Number(value || 0);
}

async function getSnapshot(sql) {
  const [customers, reservations, aging, orders, orderItems, ledger, audit] = await Promise.all([
    sql`SELECT * FROM partner_customers ORDER BY created_at ASC`,
    sql`SELECT * FROM partner_reservations ORDER BY created_at ASC`,
    sql`SELECT * FROM partner_aging ORDER BY created_at ASC`,
    sql`SELECT * FROM partner_orders ORDER BY created_at ASC`,
    sql`SELECT * FROM partner_order_items ORDER BY created_at ASC`,
    sql`SELECT * FROM partner_reservation_ledger ORDER BY created_at ASC`,
    sql`SELECT * FROM partner_audit_events ORDER BY created_at ASC`,
  ]);
  return { version: 1, createdAt: new Date().toISOString(), customers, reservations, aging, orders, orderItems, ledger, audit };
}

async function createBackup(sql, reason) {
  const snapshot = await getSnapshot(sql);
  const id = crypto.randomUUID();
  await sql`INSERT INTO partner_backups (id, reason, snapshot) VALUES (${id}, ${reason}, ${JSON.stringify(snapshot)}::jsonb)`;
  return { id, reason, createdAt: snapshot.createdAt };
}

async function recordAudit(sql, actor, eventType, details = {}) {
  await sql`INSERT INTO partner_audit_events (id, actor, event_type, details) VALUES (${crypto.randomUUID()}, ${actor}, ${eventType}, ${JSON.stringify(details)}::jsonb)`;
}

async function getCatalog(config) {
  const response = await fetch(config.catalogUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("catalog_read_only_source_unavailable");
  const payload = await response.json();
  const products = Array.isArray(payload.products) ? payload.products : [];
  return products.slice(0, 1000).map((product) => {
    const technical = product.technical || {};
    return {
      model: cleanText(product.model, 100),
      name: cleanText(product.name, 180),
      category: cleanText(product.category, 100),
      colors: Array.isArray(product.colors) ? product.colors.map((color) => cleanText(color, 50)).filter(Boolean).slice(0, 12) : [],
      documents: Array.isArray(product.documents) ? product.documents.map((document) => ({ title: cleanText(document.title, 100), url: cleanText(document.url, 1000) })).filter((document) => document.url.startsWith("http")) : [],
      technical: {
        facts: Array.isArray(technical.facts) ? technical.facts.map((fact) => cleanText(fact, 120)).filter(Boolean).slice(0, 20) : [],
        dimensionsCm: numericFields(technical.dimensionsCm, ["widthCm", "heightCm", "depthCm"]),
        capacities: numericFields(technical.capacities, ["totalLiters", "fridgeLiters", "freezerLiters", "ovenLiters", "washKg", "bottleCount", "placeSettings"]),
        performance: { ...numericFields(technical.performance, ["powerW", "programCount", "noiseDb", "waterConsumptionLiters", "spinRpm", "airflowM3h", "screenSizeInches"]), ...(cleanText(technical.performance?.energyRating, 8) ? { energyRating: cleanText(technical.performance.energyRating, 8) } : {}) },
      },
    };
  }).filter((product) => product.model || product.name);
}

function numericFields(value, allowed) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(allowed.map((key) => [key, Number(source[key])]).filter(([, number]) => Number.isFinite(number) && number >= 0));
}

async function listCustomers(sql) {
  return sql`SELECT id, name, phone, created_at, updated_at FROM partner_customers ORDER BY name ASC`;
}

async function listReservations(sql) {
  return sql`SELECT r.id, r.customer_id, r.product_model, r.initial_quantity, r.remaining_quantity, r.created_at, r.updated_at, c.name AS customer_name
    FROM partner_reservations r JOIN partner_customers c ON c.id = r.customer_id
    ORDER BY c.name ASC, r.created_at ASC`;
}

async function listAging(sql) {
  return sql`SELECT a.id, a.customer_id, a.outstanding_amount, a.notes, a.created_at, a.updated_at, c.name AS customer_name
    FROM partner_aging a JOIN partner_customers c ON c.id = a.customer_id
    ORDER BY outstanding_amount DESC, c.name ASC`;
}

async function listOrders(sql, session, all = false) {
  if (all) {
    return sql`SELECT o.id, o.status, o.created_by, o.note, o.created_at, o.updated_at, c.name AS customer_name,
      COALESCE(json_agg(json_build_object('model', i.product_model, 'name', i.product_name, 'quantity', i.quantity, 'reservationQuantity', i.reservation_quantity) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
      FROM partner_orders o JOIN partner_customers c ON c.id = o.customer_id LEFT JOIN partner_order_items i ON i.order_id = o.id
      GROUP BY o.id, c.name ORDER BY o.created_at DESC`;
  }
  return sql`SELECT o.id, o.status, o.created_by, o.note, o.created_at, o.updated_at, c.name AS customer_name,
    COALESCE(json_agg(json_build_object('model', i.product_model, 'name', i.product_name, 'quantity', i.quantity, 'reservationQuantity', i.reservation_quantity) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
    FROM partner_orders o JOIN partner_customers c ON c.id = o.customer_id LEFT JOIN partner_order_items i ON i.order_id = o.id
    WHERE o.created_by = ${session.role}
    GROUP BY o.id, c.name ORDER BY o.created_at DESC`;
}

async function dashboard(sql, session) {
  const [pending, customerCount, withdrawalCount, mine] = await Promise.all([
    sql`SELECT count(*)::int AS count FROM partner_orders WHERE status = 'pending_owner_approval'`,
    sql`SELECT count(*)::int AS count FROM partner_customers`,
    sql`SELECT count(*)::int AS count FROM partner_reservation_ledger WHERE action = 'withdrawal'`,
    sql`SELECT count(*)::int AS count FROM partner_orders WHERE created_by = ${session.role}`,
  ]);
  return { pendingOrders: pending[0].count, customers: customerCount[0].count, reservationWithdrawals: withdrawalCount[0].count, myOrders: mine[0].count };
}

async function createOrder(sql, session, body) {
  const customerId = cleanText(body.customerId, 100);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!customerId || !items.length || items.length > 100) throw new Error("invalid_order");
  const safeItems = items.map((item) => ({
    model: cleanText(item.model, 100),
    name: cleanText(item.name || item.model, 180),
    quantity: normaliseQuantity(item.quantity),
    reservationId: cleanText(item.reservationId, 100) || null,
  }));
  if (safeItems.some((item) => !item.model)) throw new Error("invalid_order_item");

  return sql.begin(async (tx) => {
    const customer = await tx`SELECT id, name FROM partner_customers WHERE id = ${customerId}`;
    if (!customer.length) throw new Error("customer_not_found");
    const beforeBackup = await createBackup(tx, "before-order-create");
    const orderId = crypto.randomUUID();
    await tx`INSERT INTO partner_orders (id, customer_id, created_by, status, note) VALUES (${orderId}, ${customerId}, ${session.role}, 'pending_owner_approval', '')`;
    const withdrawals = [];
    for (const item of safeItems) {
      let reservationQuantity = 0;
      let lockedRows;
      if (item.reservationId) {
        lockedRows = await tx`SELECT id, remaining_quantity FROM partner_reservations
          WHERE id = ${item.reservationId} AND customer_id = ${customerId} AND product_model = ${item.model} AND remaining_quantity > 0 FOR UPDATE`;
      } else {
        lockedRows = await tx`SELECT id, remaining_quantity FROM partner_reservations
          WHERE customer_id = ${customerId} AND product_model = ${item.model} AND remaining_quantity > 0
          ORDER BY created_at ASC FOR UPDATE`;
      }
      let remainingToAllocate = item.quantity;
      for (const reservation of lockedRows) {
        if (remainingToAllocate <= 0) break;
        const take = Math.min(remainingToAllocate, asNumber(reservation.remaining_quantity));
        if (take <= 0) continue;
        const updated = await tx`UPDATE partner_reservations SET remaining_quantity = remaining_quantity - ${take}, updated_at = now()
          WHERE id = ${reservation.id} AND remaining_quantity >= ${take} RETURNING remaining_quantity`;
        if (!updated.length) throw new Error("reservation_concurrency_conflict");
        await tx`INSERT INTO partner_reservation_ledger (id, reservation_id, order_id, quantity_delta, action, actor)
          VALUES (${crypto.randomUUID()}, ${reservation.id}, ${orderId}, ${-take}, 'withdrawal', ${session.role})`;
        withdrawals.push({ reservationId: reservation.id, model: item.model, quantity: take, remaining: asNumber(updated[0].remaining_quantity) });
        reservationQuantity += take;
        remainingToAllocate -= take;
      }
      await tx`INSERT INTO partner_order_items (id, order_id, product_model, product_name, quantity, reservation_quantity)
        VALUES (${crypto.randomUUID()}, ${orderId}, ${item.model}, ${item.name}, ${item.quantity}, ${reservationQuantity})`;
    }
    await recordAudit(tx, session.role, "order_created", { orderId, customerId, itemCount: safeItems.length, reservationWithdrawals: withdrawals.length });
    const afterBackup = await createBackup(tx, "after-order-create");
    return { orderId, customer: customer[0].name, reservationWithdrawals: withdrawals, beforeBackup, afterBackup };
  });
}

async function saveEntity(sql, session, body) {
  requireRole(session, "owner");
  const entity = cleanText(body.entity, 30);
  const values = body.values || {};
  return sql.begin(async (tx) => {
    const beforeBackup = await createBackup(tx, `before-owner-${entity}-save`);
    let id;
    if (entity === "customer") {
      const name = cleanText(values.name, 150);
      if (!name) throw new Error("customer_name_required");
      id = crypto.randomUUID();
      await tx`INSERT INTO partner_customers (id, name, phone) VALUES (${id}, ${name}, ${cleanText(values.phone, 50)})`;
    } else if (entity === "reservation") {
      const customerId = cleanText(values.customerId, 100);
      const model = cleanText(values.productModel, 100);
      const quantity = normaliseQuantity(values.quantity);
      const customer = await tx`SELECT id FROM partner_customers WHERE id = ${customerId}`;
      if (!customer.length || !model) throw new Error("invalid_reservation");
      id = crypto.randomUUID();
      await tx`INSERT INTO partner_reservations (id, customer_id, product_model, initial_quantity, remaining_quantity) VALUES (${id}, ${customerId}, ${model}, ${quantity}, ${quantity})`;
      await tx`INSERT INTO partner_reservation_ledger (id, reservation_id, quantity_delta, action, actor) VALUES (${crypto.randomUUID()}, ${id}, ${quantity}, 'owner_seed', 'owner')`;
    } else if (entity === "aging") {
      const customerId = cleanText(values.customerId, 100);
      const customer = await tx`SELECT id FROM partner_customers WHERE id = ${customerId}`;
      if (!customer.length) throw new Error("invalid_aging_customer");
      id = crypto.randomUUID();
      await tx`INSERT INTO partner_aging (id, customer_id, outstanding_amount, notes) VALUES (${id}, ${customerId}, ${Number(values.amount || 0)}, ${cleanText(values.notes, 500)})`;
    } else {
      throw new Error("unsupported_owner_entity");
    }
    await recordAudit(tx, "owner", "owner_entity_saved", { entity, id });
    const afterBackup = await createBackup(tx, `after-owner-${entity}-save`);
    return { id, beforeBackup, afterBackup };
  });
}

async function approveOrder(sql, session, body) {
  requireRole(session, "owner");
  const orderId = cleanText(body.orderId, 100);
  if (!orderId) throw new Error("invalid_order_id");
  return sql.begin(async (tx) => {
    const beforeBackup = await createBackup(tx, "before-owner-order-approval");
    const updated = await tx`UPDATE partner_orders SET status = 'approved', updated_at = now() WHERE id = ${orderId} AND status = 'pending_owner_approval' RETURNING id`;
    if (!updated.length) throw new Error("order_not_pending");
    await recordAudit(tx, "owner", "order_approved_in_isolated_portal", { orderId });
    const afterBackup = await createBackup(tx, "after-owner-order-approval");
    return { orderId, beforeBackup, afterBackup };
  });
}

async function seedDemo(sql, session) {
  requireRole(session, "owner");
  const existing = await sql`SELECT count(*)::int AS count FROM partner_customers`;
  if (existing[0].count) throw new Error("demo_seed_only_available_for_empty_portal");
  return sql.begin(async (tx) => {
    const beforeBackup = await createBackup(tx, "before-demo-seed");
    const customerId = crypto.randomUUID();
    const reservationId = crypto.randomUUID();
    await tx`INSERT INTO partner_customers (id, name, phone) VALUES (${customerId}, 'לקוח בדיקה — איתן', '0500000000')`;
    await tx`INSERT INTO partner_reservations (id, customer_id, product_model, initial_quantity, remaining_quantity) VALUES (${reservationId}, ${customerId}, 'DEMO-488', 3, 3)`;
    await tx`INSERT INTO partner_reservation_ledger (id, reservation_id, quantity_delta, action, actor) VALUES (${crypto.randomUUID()}, ${reservationId}, 3, 'owner_seed', 'owner')`;
    await tx`INSERT INTO partner_aging (id, customer_id, outstanding_amount, notes) VALUES (${crypto.randomUUID()}, ${customerId}, 1250, 'נתון בדיקה בלבד')`;
    await recordAudit(tx, "owner", "demo_seed_created", { customerId, reservationId });
    const afterBackup = await createBackup(tx, "after-demo-seed");
    return { customerId, reservationId, beforeBackup, afterBackup };
  });
}

function isCronAuthorized(request, config) {
  const expected = `Bearer ${config.cronSecret}`;
  const actual = request.headers.authorization || "";
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Portal-Isolation", "partner-database-only");
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.end();
    return;
  }
  try {
    const config = getConfig();
    const sql = getSql(config);
    await ensureSchema(sql);
    const url = new URL(request.url, "https://partner.invalid");
    const action = url.searchParams.get("action") || "";
    const resource = url.searchParams.get("resource") || "";

    if (action === "daily-backup") {
      if (!isCronAuthorized(request, config)) return sendJson(response, 401, { error: "unauthorized_cron" });
      const backup = await sql.begin((tx) => createBackup(tx, "daily-scheduled"));
      return sendJson(response, 200, { ok: true, backup });
    }
    if (request.method === "POST" && action === "login") {
      const body = await readJsonBody(request);
      const pin = String(body.pin || "");
      const role = pin === config.ownerPin ? "owner" : pin === config.eitanPin ? "eitan" : null;
      if (!role) return sendJson(response, 401, { error: "invalid_pin", message: "קוד הכניסה אינו תקין." });
      setSessionCookie(response, createSession(role, config));
      return sendJson(response, 200, { ok: true, user: { role } });
    }
    if (request.method === "POST" && action === "logout") {
      clearSessionCookie(response);
      return sendJson(response, 200, { ok: true });
    }
    const session = readSession(request, config);
    if (request.method === "GET" && resource === "session") return sendJson(response, 200, { user: session ? { role: session.role } : null });
    requireRole(session, "owner", "eitan");

    if (request.method === "GET" && resource === "catalog") return sendJson(response, 200, { products: await getCatalog(config) });
    if (request.method === "GET" && resource === "customers") return sendJson(response, 200, { items: await listCustomers(sql) });
    if (request.method === "GET" && resource === "reservations") return sendJson(response, 200, { items: await listReservations(sql) });
    if (request.method === "GET" && resource === "aging") return sendJson(response, 200, { items: await listAging(sql) });
    if (request.method === "GET" && resource === "orders") return sendJson(response, 200, { items: await listOrders(sql, session) });
    if (request.method === "GET" && resource === "owner-orders") {
      requireRole(session, "owner");
      return sendJson(response, 200, { items: await listOrders(sql, session, true) });
    }
    if (request.method === "GET" && resource === "backups") {
      requireRole(session, "owner");
      const items = await sql`SELECT id, reason, created_at FROM partner_backups ORDER BY created_at DESC LIMIT 50`;
      return sendJson(response, 200, { items });
    }
    if (request.method === "GET" && resource === "dashboard") return sendJson(response, 200, await dashboard(sql, session));
    if (request.method === "POST" && action === "create-order") return sendJson(response, 201, { ok: true, ...(await createOrder(sql, session, await readJsonBody(request))) });
    if (request.method === "POST" && action === "save-entity") return sendJson(response, 201, { ok: true, ...(await saveEntity(sql, session, await readJsonBody(request))) });
    if (request.method === "POST" && action === "approve-order") return sendJson(response, 200, { ok: true, ...(await approveOrder(sql, session, await readJsonBody(request))) });
    if (request.method === "POST" && action === "seed-demo") return sendJson(response, 201, { ok: true, ...(await seedDemo(sql, session)) });
    return sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    const status = error.statusCode || (error.message === "partner_portal_not_configured" ? 503 : 400);
    console.error("partner_portal_request_failed", error);
    return sendJson(response, status, { error: error.message || "partner_portal_request_failed", message: error.message === "partner_portal_not_configured" ? "הפורטל המבודד עדיין לא הוגדר." : "לא ניתן להשלים את הפעולה בפורטל המבודד." });
  }
}

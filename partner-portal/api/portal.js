import crypto from "node:crypto";
import postgres from "postgres";

const COOKIE_NAME = "price_search_partner_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const DEFAULT_CATALOG_URL = "https://price-search-teal.vercel.app/api/dealer-catalog";
const DEFAULT_MAIN_SYNC_URL = "https://price-search-teal.vercel.app/api/eitan-live-data";
const DEFAULT_MAIN_ORDER_URL = "https://price-search-teal.vercel.app/api/eitan-portal-orders";
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
    // Vercel Cron injects CRON_SECRET into the Authorization header. The
    // namespaced value remains supported for local verification.
    cronSecret: process.env.CRON_SECRET || process.env.TEAM_PORTAL_CRON_SECRET,
    bridgeSecret: process.env.TEAM_PORTAL_OWNER_BRIDGE_SECRET || "",
    catalogUrl: process.env.TEAM_PORTAL_CATALOG_URL || DEFAULT_CATALOG_URL,
    mainSyncUrl: process.env.TEAM_PORTAL_MAIN_SYNC_URL || DEFAULT_MAIN_SYNC_URL,
    mainSyncSecret: process.env.TEAM_PORTAL_MAIN_SYNC_SECRET || "",
    mainOrderUrl: process.env.TEAM_PORTAL_MAIN_ORDER_URL || DEFAULT_MAIN_ORDER_URL,
    mainOrderSecret: process.env.TEAM_PORTAL_MAIN_ORDER_SECRET || "",
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
        main_customer_id TEXT UNIQUE,
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
        status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('pending_owner_approval', 'processing', 'approved', 'cancelled', 'sent_to_main', 'sync_failed')),
        sync_action TEXT NOT NULL DEFAULT 'create' CHECK (sync_action IN ('create', 'update', 'delete')),
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
      await sql`ALTER TABLE partner_customers ADD COLUMN IF NOT EXISTS main_customer_id TEXT`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS partner_customers_main_customer_id_key ON partner_customers(main_customer_id) WHERE main_customer_id IS NOT NULL`;
      await sql`ALTER TABLE partner_order_items ADD COLUMN IF NOT EXISTS sku_key TEXT NOT NULL DEFAULT ''`;
      await sql`ALTER TABLE partner_order_items ADD COLUMN IF NOT EXISTS unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE partner_order_items ADD COLUMN IF NOT EXISTS list_price NUMERIC(14, 2) NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE partner_order_items ADD COLUMN IF NOT EXISTS from_reservation BOOLEAN NOT NULL DEFAULT false`;
      // Earlier pilot databases allowed only pending/approved/cancelled. The
      // short processing state makes owner approval safe to retry without
      // ever creating the main order twice.
      await sql`ALTER TABLE partner_orders DROP CONSTRAINT IF EXISTS partner_orders_status_check`;
      await sql`ALTER TABLE partner_orders ADD CONSTRAINT partner_orders_status_check CHECK (status IN ('pending_owner_approval', 'processing', 'approved', 'cancelled', 'sent_to_main', 'sync_failed'))`;
      await sql`ALTER TABLE partner_orders ADD COLUMN IF NOT EXISTS sync_action TEXT NOT NULL DEFAULT 'create'`;
      await sql`ALTER TABLE partner_orders DROP CONSTRAINT IF EXISTS partner_orders_sync_action_check`;
      await sql`ALTER TABLE partner_orders ADD CONSTRAINT partner_orders_sync_action_check CHECK (sync_action IN ('create', 'update', 'delete'))`;
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

function asMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function modelKey(value) {
  return cleanText(value, 180).toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");
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
      documents: Array.isArray(product.documents) ? product.documents.map((document) => ({ label: cleanText(document.label || document.title, 100), type: cleanText(document.type, 40), url: cleanText(document.url, 1000) })).filter((document) => document.url.startsWith("http")) : [],
      technical: {
        facts: Array.isArray(technical.facts) ? technical.facts.map((fact) => cleanText(fact, 120)).filter(Boolean).slice(0, 20) : [],
        dimensionsCm: numericFields(technical.dimensionsCm, ["widthCm", "heightCm", "depthCm"]),
        capacities: numericFields(technical.capacities, ["totalLiters", "fridgeLiters", "freezerLiters", "ovenLiters", "washKg", "bottleCount", "placeSettings"]),
        performance: { ...numericFields(technical.performance, ["powerW", "programCount", "noiseDb", "waterConsumptionLiters", "spinRpm", "airflowM3h", "screenSizeInches"]), ...(cleanText(technical.performance?.energyRating, 8) ? { energyRating: cleanText(technical.performance.energyRating, 8) } : {}) },
      },
    };
  }).filter((product) => product.model || product.name);
}

async function getLiveWorkspace(config) {
  if (!config.mainSyncSecret) throw new Error("main_sync_not_configured");
  const [mainResponse, technicalCatalog] = await Promise.all([
    fetch(config.mainSyncUrl, {
      headers: { Accept: "application/json", "x-eitan-sync": config.mainSyncSecret },
    }),
    getCatalog(config),
  ]);
  if (!mainResponse.ok) throw new Error("main_sync_unavailable");
  const main = await mainResponse.json();
  const technicalByModel = new Map(technicalCatalog.map((product) => [modelKey(product.model), product]));
  const products = (Array.isArray(main.products) ? main.products : []).map((product) => {
    const sku = cleanText(product.sku, 120);
    const technical = technicalByModel.get(modelKey(sku));
    return {
      model: sku,
      skuKey: sku,
      name: cleanText(product.description || sku, 240),
      category: technical?.category || "",
      colors: technical?.colors || [],
      technical: technical?.technical || { facts: [], dimensionsCm: {}, capacities: {}, performance: {} },
      documents: technical?.documents || [],
      price: asMoney(product.price),
      stockQuantity: Number.isFinite(Number(product.stockQuantity)) ? Number(product.stockQuantity) : null,
    };
  }).filter((product) => product.model && product.name);
  return {
    updatedAt: cleanText(main.updatedAt, 80),
    products,
    customers: Array.isArray(main.customers) ? main.customers : [],
    reservations: Array.isArray(main.reservations) ? main.reservations : [],
    aging: Array.isArray(main.aging) ? main.aging : [],
  };
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
    return sql`SELECT o.id, o.status, o.sync_action, o.created_by, o.note, o.created_at, o.updated_at, c.name AS customer_name, c.phone AS customer_phone, c.main_customer_id AS "mainCustomerId",
      COALESCE(json_agg(json_build_object('model', i.product_model, 'skuKey', i.sku_key, 'name', i.product_name, 'quantity', i.quantity, 'reservationQuantity', i.reservation_quantity, 'unitPrice', i.unit_price, 'listPrice', i.list_price, 'fromReservation', i.from_reservation) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
      FROM partner_orders o JOIN partner_customers c ON c.id = o.customer_id LEFT JOIN partner_order_items i ON i.order_id = o.id
      GROUP BY o.id, c.name, c.phone, c.main_customer_id ORDER BY o.created_at DESC`;
  }
  return sql`SELECT o.id, o.status, o.sync_action, o.created_by, o.note, o.created_at, o.updated_at, c.name AS customer_name, c.phone AS customer_phone, c.main_customer_id AS "mainCustomerId",
    COALESCE(json_agg(json_build_object('model', i.product_model, 'skuKey', i.sku_key, 'name', i.product_name, 'quantity', i.quantity, 'reservationQuantity', i.reservation_quantity, 'unitPrice', i.unit_price, 'listPrice', i.list_price, 'fromReservation', i.from_reservation) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
    FROM partner_orders o JOIN partner_customers c ON c.id = o.customer_id LEFT JOIN partner_order_items i ON i.order_id = o.id
    WHERE o.created_by = ${session.role} AND o.status <> 'cancelled'
    GROUP BY o.id, c.name, c.phone, c.main_customer_id ORDER BY o.created_at DESC`;
}

async function listOwnerQueue(sql) {
  return sql`SELECT o.id, o.status, o.created_by, o.note, o.created_at, o.updated_at, c.name AS customer_name, c.phone AS customer_phone, c.main_customer_id AS "mainCustomerId",
    COALESCE(json_agg(json_build_object('model', i.product_model, 'skuKey', i.sku_key, 'name', i.product_name, 'quantity', i.quantity, 'reservationQuantity', i.reservation_quantity, 'unitPrice', i.unit_price, 'listPrice', i.list_price, 'fromReservation', i.from_reservation) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
    FROM partner_orders o JOIN partner_customers c ON c.id = o.customer_id LEFT JOIN partner_order_items i ON i.order_id = o.id
    WHERE o.created_by = 'eitan'
      AND o.status = 'sent_to_main'
      AND (o.created_at AT TIME ZONE 'Asia/Jerusalem')::date = (NOW() AT TIME ZONE 'Asia/Jerusalem')::date
    GROUP BY o.id, c.name, c.phone, c.main_customer_id
    ORDER BY o.created_at DESC`;
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

async function createOrder(sql, session, body, config) {
  const customerId = cleanText(body.customerId, 100);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!customerId || !items.length || items.length > 100) throw new Error("invalid_order");
  const live = await getLiveWorkspace(config);
  const customer = live.customers.find((item) => cleanText(item.id, 100) === customerId);
  if (!customer) throw new Error("main_customer_not_found");
  const safeItems = buildSafePartnerOrderItems(live, customerId, items);

  return sql.begin(async (tx) => {
    const mirrorCustomer = await ensureMirrorCustomer(tx, customer);
    const beforeBackup = await createBackup(tx, "before-order-create");
    const orderId = crypto.randomUUID();
    await tx`INSERT INTO partner_orders (id, customer_id, created_by, status, sync_action, note) VALUES (${orderId}, ${mirrorCustomer.id}, ${session.role}, 'processing', 'create', '')`;
    for (const item of safeItems) {
      await tx`INSERT INTO partner_order_items (id, order_id, product_model, product_name, sku_key, quantity, reservation_quantity, unit_price, list_price, from_reservation)
        VALUES (${crypto.randomUUID()}, ${orderId}, ${item.model}, ${item.name}, ${item.skuKey}, ${item.quantity}, ${item.reservationQuantity}, ${item.unitPrice}, ${item.listPrice}, ${item.fromReservation})`;
    }
    await recordAudit(tx, session.role, "order_created_for_main_import", { orderId, customerId, itemCount: safeItems.length });
    const afterBackup = await createBackup(tx, "after-order-create");
    return {
      orderId,
      order: await getOwnerQueueOrder(tx, orderId),
      customer: mirrorCustomer.name,
      plannedReservationUnits: safeItems.reduce((sum, item) => sum + item.reservationQuantity, 0),
      beforeBackup,
      afterBackup,
    };
  });
}

function buildSafePartnerOrderItems(live, customerId, items) {
  return items.map((item) => {
    const model = cleanText(item.skuKey || item.model, 100);
    const product = live.products.find((candidate) => modelKey(candidate.skuKey || candidate.model) === modelKey(model));
    if (!product) throw new Error("main_product_not_found");
    const quantity = normaliseQuantity(item.quantity);
    const plannedReservation = Boolean(item.fromReservation)
      ? Math.min(quantity, live.reservations
        .filter((reservation) => cleanText(reservation.customerId, 100) === customerId && modelKey(reservation.skuKey || reservation.sku) === modelKey(product.skuKey || product.model))
        .reduce((sum, reservation) => sum + Math.max(0, asNumber(reservation.quantity)), 0))
      : 0;
    return {
      model: cleanText(product.model, 100),
      skuKey: cleanText(product.skuKey || product.model, 100),
      name: cleanText(product.name || product.model, 180),
      quantity,
      reservationQuantity: plannedReservation,
      fromReservation: plannedReservation > 0,
      unitPrice: Number.isFinite(Number(item.unitPrice ?? item.price)) && Number(item.unitPrice ?? item.price) >= 0 ? asMoney(item.unitPrice ?? item.price) : asMoney(product.price),
      listPrice: asMoney(product.price),
    };
  });
}

async function updateOrder(sql, session, body, config) {
  requireRole(session, "eitan");
  const orderId = cleanText(body.orderId, 100);
  const customerId = cleanText(body.customerId, 100);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!orderId || !customerId || !items.length || items.length > 100) throw new Error("invalid_order");
  const live = await getLiveWorkspace(config);
  const customer = live.customers.find((item) => cleanText(item.id, 100) === customerId);
  if (!customer) throw new Error("main_customer_not_found");
  const safeItems = buildSafePartnerOrderItems(live, customerId, items);
  return sql.begin(async (tx) => {
    const current = await tx`SELECT id FROM partner_orders WHERE id = ${orderId} AND created_by = 'eitan' AND status IN ('sent_to_main', 'sync_failed', 'processing') FOR UPDATE`;
    if (!current.length) throw new Error("order_not_editable");
    const mirrorCustomer = await ensureMirrorCustomer(tx, customer);
    const beforeBackup = await createBackup(tx, "before-order-update");
    await tx`UPDATE partner_orders SET customer_id = ${mirrorCustomer.id}, status = 'processing', sync_action = 'update', updated_at = now() WHERE id = ${orderId}`;
    await tx`DELETE FROM partner_order_items WHERE order_id = ${orderId}`;
    for (const item of safeItems) {
      await tx`INSERT INTO partner_order_items (id, order_id, product_model, product_name, sku_key, quantity, reservation_quantity, unit_price, list_price, from_reservation)
        VALUES (${crypto.randomUUID()}, ${orderId}, ${item.model}, ${item.name}, ${item.skuKey}, ${item.quantity}, ${item.reservationQuantity}, ${item.unitPrice}, ${item.listPrice}, ${item.fromReservation})`;
    }
    await recordAudit(tx, session.role, "order_updated_for_main_import", { orderId, customerId, itemCount: safeItems.length });
    const afterBackup = await createBackup(tx, "after-order-update");
    return { orderId, order: await getOwnerQueueOrder(tx, orderId), plannedReservationUnits: safeItems.reduce((sum, item) => sum + item.reservationQuantity, 0), beforeBackup, afterBackup };
  });
}

async function prepareDeleteOrder(sql, session, body) {
  requireRole(session, "eitan");
  const orderId = cleanText(body.orderId, 100);
  if (!orderId) throw new Error("invalid_order_id");
  return sql.begin(async (tx) => {
    const current = await tx`SELECT id FROM partner_orders WHERE id = ${orderId} AND created_by = 'eitan' AND status IN ('sent_to_main', 'sync_failed', 'processing') FOR UPDATE`;
    if (!current.length) throw new Error("order_not_editable");
    const beforeBackup = await createBackup(tx, "before-order-delete");
    await tx`UPDATE partner_orders SET status = 'processing', sync_action = 'delete', updated_at = now() WHERE id = ${orderId}`;
    await recordAudit(tx, session.role, "order_delete_requested_for_main_import", { orderId });
    const order = await getOwnerQueueOrder(tx, orderId);
    const afterBackup = await createBackup(tx, "after-order-delete");
    return { orderId, order, beforeBackup, afterBackup };
  });
}

async function ensureMirrorCustomer(tx, customer) {
  const mainCustomerId = cleanText(customer.id, 100);
  const existing = await tx`SELECT id FROM partner_customers WHERE main_customer_id = ${mainCustomerId} LIMIT 1`;
  if (existing.length) {
    await tx`UPDATE partner_customers SET name = ${cleanText(customer.name, 150)}, phone = ${cleanText(customer.phone, 50)}, updated_at = now() WHERE id = ${existing[0].id}`;
    return { id: existing[0].id, name: cleanText(customer.name, 150) };
  }
  const id = crypto.randomUUID();
  await tx`INSERT INTO partner_customers (id, name, phone, main_customer_id) VALUES (${id}, ${cleanText(customer.name, 150)}, ${cleanText(customer.phone, 50)}, ${mainCustomerId})`;
  return { id, name: cleanText(customer.name, 150) };
}

async function sendOrderToMain(config, order, action = "create") {
  if (!config.mainOrderSecret) throw new Error("main_order_sync_not_configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(config.mainOrderUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-eitan-order": config.mainOrderSecret,
      },
      body: JSON.stringify({ action, order: action === "delete" ? { id: order.id } : order }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "main_order_import_failed");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function markOrderMainSync(sql, orderId, status, eventType, details = {}) {
  return sql.begin(async (tx) => {
    const beforeBackup = await createBackup(tx, `before-main-sync-${status}`);
    const updated = await tx`UPDATE partner_orders SET status = ${status}, updated_at = now() WHERE id = ${orderId} AND created_by = 'eitan' RETURNING id`;
    if (!updated.length) throw new Error("order_not_found");
    await recordAudit(tx, "eitan", eventType, { orderId, ...details });
    const afterBackup = await createBackup(tx, `after-main-sync-${status}`);
    return { beforeBackup, afterBackup };
  });
}

async function retryPendingMainOrders(sql, config) {
  const pending = await sql`SELECT id, sync_action FROM partner_orders WHERE created_by = 'eitan' AND status IN ('processing', 'sync_failed') ORDER BY created_at ASC LIMIT 8`;
  for (const entry of pending) {
    try {
      const order = await getOwnerQueueOrder(sql, entry.id);
      if (!order) continue;
      const action = ["create", "update", "delete"].includes(entry.sync_action) ? entry.sync_action : "create";
      const imported = await sendOrderToMain(config, order, action);
      await markOrderMainSync(sql, entry.id, action === "delete" ? "cancelled" : "sent_to_main", action === "delete" ? "main_order_delete_completed" : "main_order_import_completed", { mainOrderId: imported.orderId, retried: true, action });
    } catch (error) {
      console.warn("partner_main_order_retry_failed", entry.id, error?.message || error);
    }
  }
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
  return approveOrderByOwner(sql, orderId);
}

async function approveOrderByOwner(sql, orderId) {
  return sql.begin(async (tx) => {
    const beforeBackup = await createBackup(tx, "before-owner-order-approval");
    const updated = await tx`UPDATE partner_orders SET status = 'approved', updated_at = now() WHERE id = ${orderId} AND status = 'pending_owner_approval' RETURNING id`;
    if (!updated.length) throw new Error("order_not_pending");
    await recordAudit(tx, "owner", "order_approved_in_isolated_portal", { orderId });
    const afterBackup = await createBackup(tx, "after-owner-order-approval");
    return { orderId, beforeBackup, afterBackup };
  });
}

async function getOwnerQueueOrder(sql, orderId) {
  const rows = await sql`SELECT o.id, o.status, o.sync_action, o.created_by, o.note, o.created_at, o.updated_at, c.name AS customer_name, c.phone AS customer_phone, c.main_customer_id AS "mainCustomerId",
    COALESCE(json_agg(json_build_object('model', i.product_model, 'skuKey', i.sku_key, 'name', i.product_name, 'quantity', i.quantity, 'reservationQuantity', i.reservation_quantity, 'unitPrice', i.unit_price, 'listPrice', i.list_price, 'fromReservation', i.from_reservation) ORDER BY i.created_at) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
    FROM partner_orders o JOIN partner_customers c ON c.id = o.customer_id LEFT JOIN partner_order_items i ON i.order_id = o.id
    WHERE o.id = ${orderId} AND o.created_by = 'eitan'
    GROUP BY o.id, c.name, c.phone, c.main_customer_id`;
  return rows[0] || null;
}

async function claimOrderForMainApproval(sql, orderId) {
  return sql.begin(async (tx) => {
    const beforeBackup = await createBackup(tx, "before-main-order-approval");
    const current = await tx`SELECT id, status FROM partner_orders WHERE id = ${orderId} AND created_by = 'eitan' FOR UPDATE`;
    if (!current.length) throw new Error("order_not_found");
    if (!['pending_owner_approval', 'processing'].includes(current[0].status)) throw new Error("order_not_pending");
    if (current[0].status === 'pending_owner_approval') {
      await tx`UPDATE partner_orders SET status = 'processing', updated_at = now() WHERE id = ${orderId}`;
      await recordAudit(tx, "owner", "main_order_approval_claimed", { orderId });
    }
    const order = await getOwnerQueueOrder(tx, orderId);
    const afterBackup = await createBackup(tx, "after-main-order-approval-claim");
    return { order, beforeBackup, afterBackup };
  });
}

async function completeMainApproval(sql, orderId) {
  return sql.begin(async (tx) => {
    const beforeBackup = await createBackup(tx, "before-main-order-approval-complete");
    const updated = await tx`UPDATE partner_orders SET status = 'approved', updated_at = now() WHERE id = ${orderId} AND created_by = 'eitan' AND status = 'processing' RETURNING id`;
    if (!updated.length) throw new Error("order_not_processing");
    await recordAudit(tx, "owner", "main_order_approval_completed", { orderId });
    const afterBackup = await createBackup(tx, "after-main-order-approval-complete");
    return { orderId, beforeBackup, afterBackup };
  });
}

async function releaseMainApproval(sql, orderId) {
  return sql.begin(async (tx) => {
    const beforeBackup = await createBackup(tx, "before-main-order-approval-release");
    const updated = await tx`UPDATE partner_orders SET status = 'pending_owner_approval', updated_at = now() WHERE id = ${orderId} AND created_by = 'eitan' AND status = 'processing' RETURNING id`;
    if (updated.length) await recordAudit(tx, "owner", "main_order_approval_released", { orderId });
    const afterBackup = await createBackup(tx, "after-main-order-approval-release");
    return { orderId, released: Boolean(updated.length), beforeBackup, afterBackup };
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

function isBridgeAuthorized(request, config) {
  if (!config.bridgeSecret) return false;
  const actual = request.headers["x-owner-bridge"] || "";
  return actual.length === config.bridgeSecret.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(config.bridgeSecret));
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Portal-Isolation", "partner-database-with-read-only-main-bridge");
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
    // The main application can only reach this endpoint through its own
    // authenticated server route. The browser never receives the bridge secret.
    if (request.method === "GET" && resource === "owner-queue") {
      if (!isBridgeAuthorized(request, config)) return sendJson(response, 401, { error: "unauthorized_bridge" });
      return sendJson(response, 200, { items: await listOwnerQueue(sql) });
    }
    if (request.method === "POST" && action === "owner-queue-approve") {
      if (!isBridgeAuthorized(request, config)) return sendJson(response, 401, { error: "unauthorized_bridge" });
      const body = await readJsonBody(request);
      const orderId = cleanText(body.orderId, 100);
      if (!orderId) throw new Error("invalid_order_id");
      return sendJson(response, 200, { ok: true, ...(await approveOrderByOwner(sql, orderId)) });
    }
    if (request.method === "POST" && action === "owner-queue-claim") {
      if (!isBridgeAuthorized(request, config)) return sendJson(response, 401, { error: "unauthorized_bridge" });
      const body = await readJsonBody(request);
      const orderId = cleanText(body.orderId, 100);
      if (!orderId) throw new Error("invalid_order_id");
      return sendJson(response, 200, { ok: true, ...(await claimOrderForMainApproval(sql, orderId)) });
    }
    if (request.method === "POST" && action === "owner-queue-complete") {
      if (!isBridgeAuthorized(request, config)) return sendJson(response, 401, { error: "unauthorized_bridge" });
      const body = await readJsonBody(request);
      const orderId = cleanText(body.orderId, 100);
      if (!orderId) throw new Error("invalid_order_id");
      return sendJson(response, 200, { ok: true, ...(await completeMainApproval(sql, orderId)) });
    }
    if (request.method === "POST" && action === "owner-queue-release") {
      if (!isBridgeAuthorized(request, config)) return sendJson(response, 401, { error: "unauthorized_bridge" });
      const body = await readJsonBody(request);
      const orderId = cleanText(body.orderId, 100);
      if (!orderId) throw new Error("invalid_order_id");
      return sendJson(response, 200, { ok: true, ...(await releaseMainApproval(sql, orderId)) });
    }
    const session = readSession(request, config);
    if (request.method === "GET" && resource === "session") return sendJson(response, 200, { user: session ? { role: session.role } : null });
    requireRole(session, "owner", "eitan");

    if (request.method === "GET" && resource === "live") return sendJson(response, 200, await getLiveWorkspace(config));
    if (request.method === "GET" && resource === "catalog") return sendJson(response, 200, { products: await getCatalog(config) });
    if (request.method === "GET" && resource === "customers") return sendJson(response, 200, { items: await listCustomers(sql) });
    if (request.method === "GET" && resource === "reservations") return sendJson(response, 200, { items: await listReservations(sql) });
    if (request.method === "GET" && resource === "aging") return sendJson(response, 200, { items: await listAging(sql) });
    if (request.method === "GET" && resource === "orders") {
      await retryPendingMainOrders(sql, config);
      return sendJson(response, 200, { items: await listOrders(sql, session) });
    }
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
    if (request.method === "POST" && action === "create-order") {
      const created = await createOrder(sql, session, await readJsonBody(request), config);
      try {
        const imported = await sendOrderToMain(config, created.order, "create");
        await markOrderMainSync(sql, created.orderId, "sent_to_main", "main_order_import_completed", { mainOrderId: imported.orderId });
        return sendJson(response, 201, { ok: true, ...created, imported });
      } catch (error) {
        await markOrderMainSync(sql, created.orderId, "sync_failed", "main_order_import_failed", { error: cleanText(error?.message, 100) }).catch(() => undefined);
        throw error;
      }
    }
    if (request.method === "POST" && action === "update-order") {
      const updated = await updateOrder(sql, session, await readJsonBody(request), config);
      try {
        const imported = await sendOrderToMain(config, updated.order, "update");
        await markOrderMainSync(sql, updated.orderId, "sent_to_main", "main_order_update_completed", { mainOrderId: imported.orderId });
        return sendJson(response, 200, { ok: true, ...updated, imported });
      } catch (error) {
        await markOrderMainSync(sql, updated.orderId, "sync_failed", "main_order_update_failed", { error: cleanText(error?.message, 100) }).catch(() => undefined);
        throw error;
      }
    }
    if (request.method === "POST" && action === "delete-order") {
      const pendingDelete = await prepareDeleteOrder(sql, session, await readJsonBody(request));
      try {
        const imported = await sendOrderToMain(config, pendingDelete.order, "delete");
        await markOrderMainSync(sql, pendingDelete.orderId, "cancelled", "main_order_delete_completed", { mainOrderId: imported.orderId });
        return sendJson(response, 200, { ok: true, ...pendingDelete, imported });
      } catch (error) {
        await markOrderMainSync(sql, pendingDelete.orderId, "sync_failed", "main_order_delete_failed", { error: cleanText(error?.message, 100) }).catch(() => undefined);
        throw error;
      }
    }
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

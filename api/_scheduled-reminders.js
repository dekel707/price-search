import { isAuthorized } from "./_auth.js";
import {
  cancelScheduledEmailReminder,
  createScheduledEmailReminder,
  getScheduledEmailReminder,
  hasScheduledReminderStorage,
  listScheduledEmailReminders,
  updateScheduledEmailReminderDelivery,
} from "./_scheduled-reminder-store.js";

const TIMEZONE = "Asia/Jerusalem";
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_SCHEDULE_AHEAD_MS = 60 * 1000;

// This is a private module imported by the existing /api/state function.
// Keeping it out of a public route keeps the app within Vercel Hobby's
// serverless-function limit while its storage remains fully independent of
// the business state document.
export default async function handleScheduledReminders(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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
  if (!hasScheduledReminderStorage()) {
    sendJson(response, 503, { error: "scheduled_reminders_storage_unavailable" });
    return;
  }

  try {
    if (request.method === "GET") {
      sendJson(response, 200, {
        reminders: await listScheduledEmailReminders(),
        config: getPublicEmailConfig(),
      });
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }

    const body = await readJsonBody(request);
    const action = String(body?.action || "create");
    if (action === "create") {
      await createReminder(body, response);
      return;
    }
    if (action === "cancel") {
      await cancelReminder(body, response);
      return;
    }
    sendJson(response, 400, { error: "invalid_action" });
  } catch (error) {
    console.error("scheduled_reminders_failed", error);
    if (error instanceof PublicError) {
      sendJson(response, error.statusCode, { error: error.error, message: error.message });
      return;
    }
    sendJson(response, 500, { error: "scheduled_reminders_failed" });
  }
}

async function createReminder(body, response) {
  const id = cleanId(body?.id);
  const title = cleanText(body?.title, 160);
  const message = cleanText(body?.message, 3_000);
  const recipientEmail = cleanEmail(body?.recipientEmail);
  const dueAt = israelDateTimeToIso(body?.dueDate, body?.dueTime);

  if (!id || !title || !recipientEmail || !dueAt) {
    sendJson(response, 400, { error: "invalid_reminder", message: "יש למלא כותרת, מייל, תאריך ושעה תקינים." });
    return;
  }

  let existing = await getScheduledEmailReminder(id);
  if (existing?.status === "scheduled") {
    sendJson(response, 200, { ok: true, reminder: existing, alreadyScheduled: true });
    return;
  }
  if (existing?.status === "cancelled") {
    sendJson(response, 409, { error: "reminder_cancelled", message: "התזכורת הזו כבר בוטלה. יש ליצור תזכורת חדשה." });
    return;
  }

  const millisecondsUntilSend = new Date(dueAt).getTime() - Date.now();
  if (millisecondsUntilSend < MIN_SCHEDULE_AHEAD_MS) {
    sendJson(response, 400, { error: "schedule_too_soon", message: "יש לבחור שעה שלפחות דקה קדימה." });
    return;
  }
  if (millisecondsUntilSend > MAX_SCHEDULE_AHEAD_MS) {
    sendJson(response, 400, {
      error: "schedule_too_far",
      message: "בגרסה הראשונה אפשר לתזמן מייל עד 30 ימים קדימה.",
    });
    return;
  }

  const config = getPrivateEmailConfig();
  if (!config.enabled) {
    sendJson(response, 503, {
      error: "email_not_configured",
      message: "שליחת מייל עדיין לא מחוברת. יש להגדיר RESEND_API_KEY ו־REMINDER_EMAIL_FROM ב־Vercel.",
    });
    return;
  }

  if (!existing) {
    const created = await createScheduledEmailReminder({
      id,
      title,
      message,
      recipientEmail,
      dueAt,
      timezone: TIMEZONE,
      status: "scheduling",
      providerStatus: "",
      eventType: "schedule-requested",
    });
    existing = created.reminder;
  }

  try {
    const provider = await scheduleResendEmail({ id, title, message, recipientEmail, dueAt, config });
    const reminder = await updateScheduledEmailReminderDelivery(id, {
      status: "scheduled",
      providerId: provider.id,
      providerStatus: "scheduled",
    });
    sendJson(response, 201, { ok: true, reminder, alreadyScheduled: false });
  } catch (error) {
    try {
      await updateScheduledEmailReminderDelivery(id, {
        status: "failed",
        providerStatus: "failed",
        lastError: error instanceof PublicError ? error.message : "לא ניתן היה לתזמן את המייל.",
      });
    } catch (recordError) {
      console.error("scheduled_reminder_failure_record_failed", recordError);
    }
    throw error;
  }
}

async function cancelReminder(body, response) {
  const id = cleanId(body?.id);
  if (!id) {
    sendJson(response, 400, { error: "invalid_reminder" });
    return;
  }
  const reminder = await getScheduledEmailReminder(id);
  if (!reminder) {
    sendJson(response, 404, { error: "reminder_not_found" });
    return;
  }
  if (reminder.status === "cancelled") {
    sendJson(response, 200, { ok: true, reminder, alreadyCancelled: true });
    return;
  }

  const config = getPrivateEmailConfig();
  if (!config.enabled) {
    sendJson(response, 503, {
      error: "email_not_configured",
      message: "לא ניתן לבטל מול שירות הדיוור לפני שחיבור המייל מוגדר.",
    });
    return;
  }
  if (reminder.providerId) await cancelResendEmail(reminder.providerId, config.apiKey);
  const result = await cancelScheduledEmailReminder(id);
  sendJson(response, 200, { ok: true, reminder: result.reminder, alreadyCancelled: result.alreadyCancelled });
}

async function scheduleResendEmail({ id, title, message, recipientEmail, dueAt, config }) {
  const text = [
    `תזכורת: ${title}`,
    message,
    `מועד: ${formatIsraelDateTime(new Date(dueAt))}`,
  ].filter(Boolean).join("\n\n");
  const upstream = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `price-search-reminder-${id}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: [recipientEmail],
      subject: `תזכורת · ${title}`,
      text,
      scheduled_at: dueAt,
      tags: [
        { name: "source", value: "price-search-reminder" },
        { name: "reminder_id", value: id },
      ],
    }),
  });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok || !payload?.id) {
    console.error("resend_schedule_failed", upstream.status, payload?.message || payload?.name || "unknown");
    throw new PublicError(502, "email_schedule_failed", "שירות המייל לא אישר את התזכורת. היא לא נשמרה ולא תישלח.");
  }
  return { id: String(payload.id) };
}

async function cancelResendEmail(providerId, apiKey) {
  const upstream = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!upstream.ok) {
    const payload = await upstream.json().catch(() => ({}));
    console.error("resend_cancel_failed", upstream.status, payload?.message || payload?.name || "unknown");
    throw new PublicError(502, "email_cancel_failed", "לא ניתן היה לבטל את המייל מול שירות הדיוור. התזכורת נשארה פעילה." );
  }
}

function getPublicEmailConfig() {
  const config = getPrivateEmailConfig();
  return { emailConfigured: config.enabled, defaultRecipient: getEnvValue("REMINDER_DEFAULT_EMAIL") };
}

function getPrivateEmailConfig() {
  const apiKey = getEnvValue("RESEND_API_KEY");
  const from = getEnvValue("REMINDER_EMAIL_FROM");
  return { apiKey, from, enabled: Boolean(apiKey && from) };
}

function israelDateTimeToIso(rawDate, rawTime) {
  const date = String(rawDate || "");
  const time = String(rawTime || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) return "";
  const [, year, month, day] = match.map(Number);
  const [, hour, minute] = timeMatch.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return "";

  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = naiveUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    candidate = naiveUtc - getTimezoneOffsetMs(candidate, TIMEZONE);
  }
  const verified = israelDateParts(new Date(candidate));
  if (verified.date !== date || verified.time !== time) return "";
  return new Date(candidate).toISOString();
}

function getTimezoneOffsetMs(timestamp, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
  const inZoneAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return inZoneAsUtc - timestamp;
}

function israelDateParts(value) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(value).map(({ type, value: partValue }) => [type, partValue]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function formatIsraelDateTime(value) {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function getEnvValue(name) {
  return String(process.env[name] || "").replace(/^["']|["']$/g, "");
}

async function readJsonBody(request) {
  if (Buffer.isBuffer(request.body)) return JSON.parse(request.body.toString("utf8") || "{}");
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  if (request.body && typeof request.body === "object") return request.body;
  const body = await new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
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

class PublicError extends Error {
  constructor(statusCode, error, message) {
    super(message);
    this.statusCode = statusCode;
    this.error = error;
  }
}

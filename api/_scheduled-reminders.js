import { isAuthorized } from "./_auth.js";
import {
  cancelScheduledEmailReminder,
  createScheduledEmailReminder,
  deleteScheduledEmailReminder,
  getScheduledEmailReminder,
  hasScheduledReminderStorage,
  listScheduledEmailReminders,
  updateScheduledEmailReminderDelivery,
} from "./_scheduled-reminder-store.js";

const TIMEZONE = "Asia/Jerusalem";
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_SCHEDULE_AHEAD_MS = 60 * 1000;
const AUTOMATION_PROVIDER_PREFIX = "automation:";

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
      const reminders = await refreshDueReminderStatuses(await listScheduledEmailReminders());
      sendJson(response, 200, {
        reminders,
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
    if (action === "snooze") {
      await snoozeReminder(body, response);
      return;
    }
    if (action === "delete") {
      await deleteReminder(body, response);
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
  const priority = normalizeReminderPriority(body?.priority);
  const type = normalizeReminderType(body?.type);
  const recurrence = normalizeReminderRecurrence(body?.recurrence);

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

  assertScheduleWindow(dueAt);

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
      priority,
      type,
      recurrence,
      repeatCount: 1,
      status: "scheduling",
      providerStatus: "",
      eventType: "schedule-requested",
    });
    existing = created.reminder;
  }

  try {
    const provider = await scheduleResendAutomation({ id, title, message, recipientEmail, dueAt, recurrence, config });
    const reminder = await updateScheduledEmailReminderDelivery(id, {
      status: "scheduled",
      providerId: provider.id,
      providerStatus: "scheduled",
      priority,
      type,
      recurrence,
      repeatCount: provider.repeatCount,
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

async function snoozeReminder(body, response) {
  const id = cleanId(body?.id);
  const dueAt = parseFutureIso(body?.dueAt) || israelDateTimeToIso(body?.dueDate, body?.dueTime);
  if (!id || !dueAt) {
    sendJson(response, 400, { error: "invalid_snooze", message: "לא נבחר מועד דחייה תקין." });
    return;
  }
  assertScheduleWindow(dueAt);

  const reminder = await getScheduledEmailReminder(id);
  if (!reminder) {
    sendJson(response, 404, { error: "reminder_not_found" });
    return;
  }
  if (reminder.status !== "scheduled") {
    sendJson(response, 409, { error: "email_already_processed", message: "אפשר לדחות רק תזכורת שממתינה לשליחה." });
    return;
  }

  const config = getPrivateEmailConfig();
  if (!config.enabled) {
    sendJson(response, 503, { error: "email_not_configured", message: "חיבור המייל אינו זמין כרגע." });
    return;
  }

  if (reminder.providerId) {
    const refreshed = await refreshReminderProviderStatus(reminder, config);
    if (refreshed.status !== "scheduled") {
      sendJson(response, 409, {
        error: "email_already_processed",
        message: "המייל כבר יצא לשליחה ולכן אי אפשר לדחות אותו.",
        reminder: refreshed,
      });
      return;
    }
  }

  const nextId = cleanId(body?.nextId) || createServerReminderId();
  const title = cleanText(reminder.title, 160);
  const message = cleanText(reminder.message, 3_000);
  const recipientEmail = cleanEmail(reminder.recipientEmail);
  const priority = normalizeReminderPriority(reminder.priority);
  const type = normalizeReminderType(reminder.type);
  const recurrence = normalizeReminderRecurrence(reminder.recurrence);
  let provider = null;
  try {
    await createScheduledEmailReminder({
      id: nextId,
      title,
      message,
      recipientEmail,
      dueAt,
      timezone: TIMEZONE,
      priority,
      type,
      recurrence,
      repeatCount: 1,
      status: "scheduling",
      providerStatus: "",
      eventType: "snoozed",
    });
    provider = await scheduleResendAutomation({ id: nextId, title, message, recipientEmail, dueAt, recurrence, config });
    // The new reminder is accepted before the old one is stopped, so a
    // temporary provider failure cannot make a user lose the original task.
    if (reminder.providerId) await cancelResendEmail(reminder.providerId, config.apiKey);
    await cancelScheduledEmailReminder(id);
    const nextReminder = await updateScheduledEmailReminderDelivery(nextId, {
      status: "scheduled",
      providerId: provider.id,
      providerStatus: "scheduled",
      priority,
      type,
      recurrence,
      repeatCount: provider.repeatCount,
    });
    sendJson(response, 201, { ok: true, reminder: nextReminder, replacedId: id });
  } catch (error) {
    if (provider?.id) {
      await cancelResendEmail(provider.id, config.apiKey).catch((cancelError) => {
        console.error("scheduled_reminder_snooze_provider_cleanup_failed", cancelError);
      });
    }
    try {
      await updateScheduledEmailReminderDelivery(nextId, {
        status: "failed",
        providerStatus: "failed",
        priority,
        type,
        recurrence,
        lastError: error instanceof PublicError ? error.message : "לא ניתן היה לדחות את המייל.",
      });
    } catch (recordError) {
      console.error("scheduled_reminder_snooze_failure_record_failed", recordError);
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
  if (reminder.providerId) {
    const refreshed = await refreshReminderProviderStatus(reminder, config);
    if (refreshed.status !== "scheduled") {
      sendJson(response, 409, {
        error: "email_already_processed",
        message: "המייל כבר יצא לשליחה או נמסר, ולכן אי אפשר לבטל אותו יותר.",
        reminder: refreshed,
      });
      return;
    }
    await cancelResendEmail(reminder.providerId, config.apiKey);
  }
  const result = await cancelScheduledEmailReminder(id);
  sendJson(response, 200, { ok: true, reminder: result.reminder, alreadyCancelled: result.alreadyCancelled });
}

async function deleteReminder(body, response) {
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
  if (reminder.status === "deleted") {
    sendJson(response, 200, { ok: true, reminder, alreadyDeleted: true });
    return;
  }

  // A future reminder must be cancelled at Resend before we hide it locally;
  // otherwise "delete" could leave an invisible email that still sends later.
  if (reminder.status === "scheduled" && reminder.providerId) {
    const config = getPrivateEmailConfig();
    if (!config.enabled) {
      sendJson(response, 503, {
        error: "email_not_configured",
        message: "לא ניתן למחוק בבטחה תזכורת שממתינה לשליחה לפני שחיבור המייל מוגדר.",
      });
      return;
    }
    const refreshed = await refreshReminderProviderStatus(reminder, config);
    if (refreshed.status === "scheduled") {
      await cancelResendEmail(refreshed.providerId, config.apiKey);
    }
  }

  const result = await deleteScheduledEmailReminder(id);
  if (result.missing || !result.reminder) {
    sendJson(response, 404, { error: "reminder_not_found" });
    return;
  }
  sendJson(response, 200, { ok: true, reminder: result.reminder, alreadyDeleted: result.alreadyDeleted });
}

async function scheduleResendAutomation({ id, title, message, recipientEmail, dueAt, recurrence = "none", config }) {
  if (!config.automationTemplateId) {
    throw new PublicError(503, "email_scheduler_not_configured", "מנגנון התזמון החדש עדיין לא הוגדר. נסה שוב בעוד רגע.");
  }

  // Resend's direct `scheduled_at` endpoint accepted a reminder and then failed
  // when dispatching it. Each reminder now gets an isolated Automation run:
  // event -> delay -> normal email send. A cancellation can therefore stop only
  // this reminder and never affect any business-state data or other reminders.
  const occurrences = buildReminderOccurrences(dueAt, recurrence);
  const eventName = `price_search_reminder_${id}`;
  const steps = [{ key: "start", type: "trigger", config: { event_name: eventName } }];
  const connections = [];
  let previousKey = "start";
  let previousAt = Date.now();
  occurrences.forEach((scheduledAt, index) => {
    const delayKey = `wait_${index + 1}`;
    const sendKey = `send_${index + 1}`;
    const delayMinutes = Math.max(1, Math.ceil((scheduledAt.getTime() - previousAt) / (60 * 1000)));
    steps.push({ key: delayKey, type: "delay", config: { duration: `${delayMinutes} minutes` } });
    steps.push({
      key: sendKey,
      type: "send_email",
      config: {
        template: {
          id: config.automationTemplateId,
          variables: {
            TITLE: { var: "event.title" },
            MESSAGE: { var: "event.message" },
            DUE_LABEL: formatIsraelDateTime(scheduledAt),
          },
        },
        from: config.from,
      },
    });
    connections.push({ from: previousKey, to: delayKey, type: "default" });
    connections.push({ from: delayKey, to: sendKey, type: "default" });
    previousKey = sendKey;
    previousAt = scheduledAt.getTime();
  });
  const automation = await resendRequest("/automations", config.apiKey, {
    method: "POST",
    body: JSON.stringify({
      name: `Price Search reminder ${id}`,
      status: "enabled",
      steps,
      connections,
    }),
    idempotencyKey: `price-search-reminder-automation-${id}`,
  });

  if (!automation?.id) {
    throw new PublicError(502, "email_schedule_failed", "שירות המייל לא אישר את התזכורת. היא לא נשמרה ולא תישלח.");
  }

  try {
    await resendRequest("/events/send", config.apiKey, {
      method: "POST",
      body: JSON.stringify({
        event: eventName,
        email: recipientEmail,
        payload: {
          title,
          message,
          dueLabel: formatIsraelDateTime(new Date(dueAt)),
        },
      }),
      idempotencyKey: `price-search-reminder-event-${id}`,
    });
  } catch (error) {
    // Do not leave a silent future Automation behind when its trigger was not
    // accepted. The local reminder will be marked failed by the caller.
    await stopResendAutomation(String(automation.id), config.apiKey).catch((stopError) => {
      console.error("resend_automation_cleanup_failed", stopError);
    });
    throw error;
  }
  return { id: `${AUTOMATION_PROVIDER_PREFIX}${automation.id}`, repeatCount: occurrences.length };
}

async function cancelResendEmail(providerId, apiKey) {
  const automationId = getAutomationId(providerId);
  if (automationId) {
    await stopResendAutomation(automationId, apiKey);
    return;
  }
  const upstream = await fetch(`https://api.resend.com/emails/${encodeURIComponent(providerId)}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!upstream.ok) {
    const payload = await upstream.json().catch(() => ({}));
    console.error("resend_cancel_failed", upstream.status, payload?.message || payload?.name || "unknown");
    throw new PublicError(502, "email_cancel_failed", "לא ניתן היה לבטל את המייל מול שירות הדיוור. התזכורת נשארה פעילה." );
  }
}

async function stopResendAutomation(automationId, apiKey) {
  const upstream = await fetch(`https://api.resend.com/automations/${encodeURIComponent(automationId)}/stop`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!upstream.ok) {
    const payload = await upstream.json().catch(() => ({}));
    console.error("resend_automation_stop_failed", upstream.status, payload?.message || payload?.name || "unknown");
    throw new PublicError(502, "email_cancel_failed", "לא ניתן היה לבטל את המייל מול שירות הדיוור. התזכורת נשארה פעילה.");
  }
}

async function resendRequest(path, apiKey, options = {}) {
  const upstream = await fetch(`https://api.resend.com${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    ...(options.body ? { body: options.body } : {}),
  });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    console.error("resend_request_failed", path, upstream.status, payload?.message || payload?.name || "unknown");
    throw new PublicError(502, "email_schedule_failed", "שירות המייל לא אישר את התזכורת. היא לא נשמרה ולא תישלח.");
  }
  return payload;
}

// Resend is the source of truth for delivery. We refresh only reminders that
// are due (or almost due), so opening the panel stays fast and does not waste
// API calls on a long list of future reminders.
async function refreshDueReminderStatuses(reminders) {
  const config = getPrivateEmailConfig();
  if (!config.enabled) return reminders;
  const now = Date.now();
  const candidates = reminders
    .filter((reminder) => reminder?.status === "scheduled" && reminder.providerId)
    .filter((reminder) => new Date(reminder.dueAt).getTime() <= now + 5 * 60 * 1000)
    .slice(0, 4);
  if (!candidates.length) return reminders;

  const updatedById = new Map();
  for (const reminder of candidates) {
    try {
      const updated = await refreshReminderProviderStatus(reminder, config);
      if (updated) updatedById.set(updated.id, updated);
    } catch (error) {
      // A status refresh must never hide an existing reminder or prevent the
      // user from seeing it. The next manual refresh can retry safely.
      console.error("resend_status_refresh_failed", error);
    }
  }
  return reminders.map((reminder) => updatedById.get(reminder.id) || reminder);
}

async function refreshReminderProviderStatus(reminder, config) {
  if (!reminder?.providerId) return reminder;
  const automationId = getAutomationId(reminder.providerId);
  if (automationId) {
    return refreshAutomationReminderStatus(reminder, automationId, config);
  }
  const upstream = await fetch(`https://api.resend.com/emails/${encodeURIComponent(reminder.providerId)}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new PublicError(502, "email_status_failed", "לא ניתן היה לרענן את סטטוס המייל מול שירות הדיוור.");
  }
  const providerStatus = normalizeProviderStatus(payload?.last_event);
  const status = providerStatusToReminderStatus(providerStatus, reminder.status);
  if (status === reminder.status && providerStatus === reminder.providerStatus) return reminder;
  return updateScheduledEmailReminderDelivery(reminder.id, {
    status,
    providerId: reminder.providerId,
    providerStatus,
    lastError: status === "failed" ? "שירות הדיוור דיווח שהמייל לא נמסר." : "",
  });
}

async function refreshAutomationReminderStatus(reminder, automationId, config) {
  const upstream = await fetch(`https://api.resend.com/automations/${encodeURIComponent(automationId)}/runs?limit=5`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new PublicError(502, "email_status_failed", "לא ניתן היה לרענן את סטטוס המייל מול שירות הדיוור.");
  }
  const latestRun = Array.isArray(payload?.data) ? payload.data[0] : null;
  const providerStatus = normalizeProviderStatus(latestRun?.status || "scheduled");
  const status = providerStatusToReminderStatus(providerStatus, reminder.status);
  if (status === reminder.status && providerStatus === reminder.providerStatus) return reminder;
  return updateScheduledEmailReminderDelivery(reminder.id, {
    status,
    providerId: reminder.providerId,
    providerStatus,
    lastError: status === "failed" ? "שירות הדיוור דיווח שהמייל לא נמסר." : "",
  });
}

function getAutomationId(providerId) {
  const value = String(providerId || "");
  return value.startsWith(AUTOMATION_PROVIDER_PREFIX) ? value.slice(AUTOMATION_PROVIDER_PREFIX.length) : "";
}

function buildReminderOccurrences(dueAt, recurrence) {
  const first = new Date(dueAt);
  const normalizedRecurrence = normalizeReminderRecurrence(recurrence);
  if (normalizedRecurrence === "none") return [first];

  const horizon = Math.min(
    Date.now() + MAX_SCHEDULE_AHEAD_MS,
    first.getTime() + MAX_SCHEDULE_AHEAD_MS,
  );
  const occurrences = [first];
  let cursor = first;
  while (occurrences.length < 31) {
    cursor = nextRecurringOccurrence(cursor, normalizedRecurrence);
    if (cursor.getTime() > horizon) break;
    occurrences.push(cursor);
  }
  return occurrences;
}

function nextRecurringOccurrence(previous, recurrence) {
  const next = new Date(previous);
  if (recurrence === "weekly") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (recurrence === "workdays" && !isIsraelWorkday(next));
  return next;
}

function isIsraelWorkday(value) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(value);
  return weekday !== "Fri" && weekday !== "Sat";
}

function normalizeProviderStatus(value) {
  return String(value || "scheduled").trim().toLowerCase().replace(/^email\./, "");
}

function providerStatusToReminderStatus(providerStatus, fallback) {
  if (["scheduled", "queued", "running"].includes(providerStatus)) return "scheduled";
  if (["completed"].includes(providerStatus)) return "sent";
  if (["sent"].includes(providerStatus)) return "sent";
  if (["delivered"].includes(providerStatus)) return "delivered";
  if (["opened"].includes(providerStatus)) return "opened";
  if (["clicked"].includes(providerStatus)) return "clicked";
  if (["bounced", "complained", "suppressed", "failed", "delivery_delayed"].includes(providerStatus)) return "failed";
  return fallback || "scheduled";
}

function getPublicEmailConfig() {
  const config = getPrivateEmailConfig();
  return { emailConfigured: config.enabled, defaultRecipient: getEnvValue("REMINDER_DEFAULT_EMAIL") };
}

function getPrivateEmailConfig() {
  const apiKey = getEnvValue("RESEND_API_KEY");
  const from = getEnvValue("REMINDER_EMAIL_FROM");
  const automationTemplateId = getEnvValue("REMINDER_AUTOMATION_TEMPLATE_ID");
  return { apiKey, from, automationTemplateId, enabled: Boolean(apiKey && from) };
}

function assertScheduleWindow(dueAt) {
  const millisecondsUntilSend = new Date(dueAt).getTime() - Date.now();
  if (millisecondsUntilSend < MIN_SCHEDULE_AHEAD_MS) {
    throw new PublicError(400, "schedule_too_soon", "יש לבחור שעה שלפחות דקה קדימה.");
  }
  if (millisecondsUntilSend > MAX_SCHEDULE_AHEAD_MS) {
    throw new PublicError(400, "schedule_too_far", "אפשר לתזמן מייל עד 30 ימים קדימה.");
  }
}

function parseFutureIso(value) {
  const candidate = new Date(String(value || ""));
  return Number.isNaN(candidate.getTime()) ? "" : candidate.toISOString();
}

function normalizeReminderPriority(value) {
  const priority = String(value || "normal").trim().toLowerCase();
  return ["urgent", "high", "normal", "low"].includes(priority) ? priority : "normal";
}

function normalizeReminderType(value) {
  const type = String(value || "task").trim().toLowerCase();
  return ["task", "future-stock", "collection", "evening-summary"].includes(type) ? type : "task";
}

function normalizeReminderRecurrence(value) {
  const recurrence = String(value || "none").trim().toLowerCase();
  return ["none", "daily", "weekly", "workdays"].includes(recurrence) ? recurrence : "none";
}

function createServerReminderId() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `mailrem-${String(random).replace(/[^a-zA-Z0-9_-]/g, "")}`;
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

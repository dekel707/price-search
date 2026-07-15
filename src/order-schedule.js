export const ORDER_REPORT_CUTOFF_HOUR = 15;

const ISRAEL_TIME_ZONE = "Asia/Jerusalem";
const weekdayIndex = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const israelScheduleFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ISRAEL_TIME_ZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function getSafeDate(value = new Date()) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getIsraelScheduleParts(value = new Date()) {
  const parts = israelScheduleFormatter.formatToParts(getSafeDate(value));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday,
    hour: Number(values.hour),
  };
}

export function getIsraelDateKey(value = new Date()) {
  return getIsraelScheduleParts(value).dateKey;
}

export function addIsraelDateKeyDays(dateKey, days) {
  const match = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return getIsraelDateKey();
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return value.toISOString().slice(0, 10);
}

export function getNextIsraelDateKey(value = new Date()) {
  return addIsraelDateKeyDays(getIsraelDateKey(value), 1);
}

export function getNextSundayIsraelDateKey(value = new Date()) {
  const parts = getIsraelScheduleParts(value);
  const daysUntilSunday = (7 - (weekdayIndex[parts.weekday] ?? 0)) % 7 || 7;
  return addIsraelDateKeyDays(parts.dateKey, daysUntilSunday);
}

export function getUpcomingSundayIsraelDateKey(value = new Date()) {
  const parts = getIsraelScheduleParts(value);
  const daysUntilSunday = (7 - (weekdayIndex[parts.weekday] ?? 0)) % 7;
  return addIsraelDateKeyDays(parts.dateKey, daysUntilSunday);
}

// Automatic reporting policy (Israel time):
// Sun–Thu before 15:00 => today; Sun–Wed from 15:00 => tomorrow;
// Thu from 15:00 and all Fri/Sat => the upcoming Sunday.
export function getAutomaticOrderReportDateKey(createdAt = new Date()) {
  const parts = getIsraelScheduleParts(createdAt);
  if (parts.weekday === "Fri" || parts.weekday === "Sat") {
    return getUpcomingSundayIsraelDateKey(createdAt);
  }
  if (parts.hour < ORDER_REPORT_CUTOFF_HOUR) return parts.dateKey;
  if (parts.weekday === "Thu") return getNextSundayIsraelDateKey(createdAt);
  return addIsraelDateKeyDays(parts.dateKey, 1);
}

export function getOrderReportDateForDraft(createdAt, reportTomorrow = false, reportToday = false) {
  const createdDateKey = getIsraelDateKey(createdAt);
  if (reportToday) return createdDateKey;
  const automaticDateKey = getAutomaticOrderReportDateKey(createdAt);
  if (!reportTomorrow) return automaticDateKey;
  return [getNextIsraelDateKey(createdAt), automaticDateKey].sort().at(-1);
}

export function isOrderReportDateCompleted(reportDateKey, reference = new Date()) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(reportDateKey)) && reportDateKey < getIsraelDateKey(reference);
}

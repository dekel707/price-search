import { isAuthorized } from "./_auth.js";

const TIME_ZONE = "Asia/Jerusalem";
const KIRYAT_ATA = { latitude: 32.8063, longitude: 35.1066 };
const datePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short" });
const timeFormatter = new Intl.DateTimeFormat("he-IL", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, max-age=300, s-maxage=900");

  if (!isAuthorized(request)) {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (request.method !== "GET") {
    response.statusCode = 405;
    response.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  try {
    const now = new Date();
    const start = getIsraelDateKey(now);
    const end = addDaysToDateKey(start, 120);
    const query = new URLSearchParams({
      cfg: "json",
      v: "1",
      maj: "on",
      min: "on",
      mod: "on",
      nx: "on",
      ss: "on",
      c: "on",
      geo: "none",
      latitude: String(KIRYAT_ATA.latitude),
      longitude: String(KIRYAT_ATA.longitude),
      tzid: TIME_ZONE,
      start,
      end,
      lg: "he",
    });
    const upstream = await fetch(`https://www.hebcal.com/hebcal?${query.toString()}`);
    if (!upstream.ok) throw new Error(`zmanim_upstream_${upstream.status}`);
    const payload = await upstream.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const candles = items.filter((item) => item?.category === "candles" && isValidDate(item.date));
    const havdalot = items.filter((item) => item?.category === "havdalah" && isValidDate(item.date));
    const majorHolidays = items.filter(
      (item) => item?.category === "holiday" && item?.subcat === "major" && !isShabbatHoliday(item) && isValidDate(item.date),
    );

    const futureCandles = candles.filter((item) => new Date(item.date).getTime() >= now.getTime() - 6 * 60 * 60 * 1000);
    const nextShabbatCandle = futureCandles.find((item) => weekdayFormatter.format(new Date(item.date)) === "Fri") || null;
    const shabbat = nextShabbatCandle
      ? {
          date: getIsraelDateKey(new Date(nextShabbatCandle.date)),
          label: "שבת קרובה",
          candleLighting: formatTime(nextShabbatCandle.date),
          havdalah: findFollowingHavdalah(nextShabbatCandle, havdalot),
        }
      : null;

    const holidays = buildHolidayTimes(futureCandles, havdalot, majorHolidays).slice(0, 3);
    response.statusCode = 200;
    response.end(
      JSON.stringify({
        location: "קריית אתא",
        source: "חישוב לפי מיקום קריית אתא",
        updatedAt: now.toISOString(),
        shabbat,
        holidays,
      }),
    );
  } catch (error) {
    console.error(error);
    response.statusCode = 502;
    response.end(JSON.stringify({ error: "zmanim_unavailable" }));
  }
}

function buildHolidayTimes(candles, havdalot, holidays) {
  const seen = new Set();
  return candles
    .map((candle) => {
      const candleDate = getIsraelDateKey(new Date(candle.date));
      const matchingHoliday = holidays.find((holiday) => {
        const holidayDate = normalizeDateKey(holiday.date);
        return holidayDate >= candleDate && holidayDate <= addDaysToDateKey(candleDate, 2) && !isHolidayEve(holiday);
      });
      if (!matchingHoliday) return null;
      const title = cleanTitle(matchingHoliday.hebrew || matchingHoliday.title);
      const key = `${normalizeDateKey(matchingHoliday.date)}-${title}`;
      if (!title || seen.has(key)) return null;
      seen.add(key);
      return {
        title,
        date: normalizeDateKey(matchingHoliday.date),
        candleLighting: formatTime(candle.date),
        havdalah: findFollowingHavdalah(candle, havdalot),
      };
    })
    .filter(Boolean);
}

function findFollowingHavdalah(candle, havdalot) {
  const start = new Date(candle.date).getTime();
  const latest = start + 4 * 24 * 60 * 60 * 1000;
  const next = havdalot.find((item) => {
    const timestamp = new Date(item.date).getTime();
    return timestamp > start && timestamp <= latest;
  });
  return next ? formatTime(next.date) : "";
}

function getIsraelDateKey(value) {
  const parts = datePartsFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function normalizeDateKey(value) {
  return String(value || "").slice(0, 10);
}

function formatTime(value) {
  return timeFormatter.format(new Date(value));
}

function isValidDate(value) {
  return !Number.isNaN(new Date(value).getTime());
}

function isHolidayEve(item) {
  const title = cleanTitle(item?.hebrew || item?.title);
  return title.startsWith("ערב ");
}

function isShabbatHoliday(item) {
  return cleanTitle(item?.hebrew || item?.title).startsWith("שבת");
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

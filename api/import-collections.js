import { isAuthorized } from "./_auth.js";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
let pdfjsPromise = null;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "14mb",
    },
  },
};

export default async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "unauthorized" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const fileName = cleanString(body.fileName);
    const contentType = cleanString(body.contentType);
    const data = decodeBase64File(body.data);

    if (!data.length || data.length > MAX_FILE_BYTES || (!contentType.includes("pdf") && !/\.pdf$/i.test(fileName))) {
      sendJson(response, data.length > MAX_FILE_BYTES ? 413 : 400, { error: data.length > MAX_FILE_BYTES ? "file_too_large" : "invalid_file" });
      return;
    }

    const result = await extractCollectionReportWithVerification(data);
    if (!result.items.length) {
      sendJson(response, 422, { error: "no_rows_detected", pageCount: result.pageCount, lineCount: result.lineCount });
      return;
    }

    sendJson(response, 200, {
      items: result.items,
      pageCount: result.pageCount,
      verifiedPasses: result.verifiedPasses,
      skippedNonPositive: result.skippedNonPositive,
      totalAmount: roundMoney(result.items.reduce((sum, item) => sum + item.amount, 0)),
    });
  } catch (error) {
    console.error("Failed to import collection report", error);
    if (error.code === "verification_failed") {
      sendJson(response, 422, { error: "verification_failed" });
      return;
    }
    sendJson(response, 500, { error: "import_failed" });
  }
}

async function extractCollectionReportWithVerification(data) {
  const first = await extractCollectionReport(data.slice());
  const second = await extractCollectionReport(data.slice());
  if (createReportSignature(first) !== createReportSignature(second)) {
    const error = new Error("Collection report verification failed");
    error.code = "verification_failed";
    throw error;
  }
  return { ...first, verifiedPasses: 2 };
}

function createReportSignature(report) {
  return JSON.stringify({
    pageCount: report.pageCount,
    lineCount: report.lineCount,
    items: report.items.map((item) => ({
      customerName: item.customerName,
      accountNumber: item.accountNumber,
      amount: item.amount,
      invoices: item.invoices.map((invoice) => ({
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        amount: invoice.amount,
        cumulative: invoice.cumulative,
      })),
    })),
  });
}

async function extractCollectionReport(data) {
  const pdfjsLib = await loadPdfjs();
  const document = await pdfjsLib.getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const rowsByCustomer = new Map();
  let lineCount = 0;
  let skippedNonPositive = 0;
  let currentCustomer = null;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent({ normalizeWhitespace: true });
    const lines = groupTextItemsIntoLines(textContent.items);
    lineCount += lines.length;

    lines.forEach((line) => {
      const header = parseCustomerHeaderLine(line.items);
      if (header) {
        currentCustomer = upsertCustomerRow(rowsByCustomer, header.customerName, { accountNumber: header.accountNumber });
        return;
      }

      const summary = parseSummaryLine(line.items);
      if (summary) {
        currentCustomer = upsertCustomerRow(rowsByCustomer, summary.customerName, { amount: summary.amount });
        return;
      }

      if (!currentCustomer) return;
      const invoice = parseInvoiceLine(line.items);
      if (!invoice) return;
      currentCustomer.invoices.push(invoice);
    });
  }

  const items = [...rowsByCustomer.values()]
    .map((row) => {
      const invoiceTotal = roundMoney(row.invoices.reduce((sum, invoice) => sum + invoice.amount, 0));
      const amount = row.amount === null ? invoiceTotal : row.amount;
      if (amount <= 0) {
        skippedNonPositive += 1;
      }
      return {
        customerName: row.customerName,
        accountNumber: row.accountNumber,
        amount: roundMoney(amount),
        invoices: row.invoices.sort(compareInvoices),
      };
    })
    .filter((row) => row.customerName && row.invoices.length);

  return {
    pageCount: document.numPages,
    lineCount,
    skippedNonPositive,
    items,
  };
}

function upsertCustomerRow(rowsByCustomer, customerName, updates = {}) {
  const key = normalizeIdentity(customerName);
  const current =
    rowsByCustomer.get(key) || {
      customerName,
      accountNumber: "",
      amount: null,
      invoices: [],
    };

  current.customerName = current.customerName || customerName;
  if (updates.accountNumber) current.accountNumber = updates.accountNumber;
  if (updates.amount !== undefined && updates.amount !== null) current.amount = roundMoney(updates.amount);
  rowsByCustomer.set(key, current);
  return current;
}

function loadPdfjs() {
  if (!pdfjsPromise) {
    installPdfRuntimePolyfills();
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

function installPdfRuntimePolyfills() {
  if (!globalThis.DOMMatrix) {
    globalThis.DOMMatrix = SimpleDOMMatrix;
  }
  if (!globalThis.Path2D) {
    globalThis.Path2D = class Path2D {
      addPath() {}
    };
  }
}

class SimpleDOMMatrix {
  constructor(init) {
    const values = normalizeMatrixValues(init);
    this.a = values[0];
    this.b = values[1];
    this.c = values[2];
    this.d = values[3];
    this.e = values[4];
    this.f = values[5];
    this.is2D = true;
  }

  multiplySelf(other) {
    const [a2, b2, c2, d2, e2, f2] = normalizeMatrixValues(other);
    const { a, b, c, d, e, f } = this;
    this.a = a * a2 + c * b2;
    this.b = b * a2 + d * b2;
    this.c = a * c2 + c * d2;
    this.d = b * c2 + d * d2;
    this.e = a * e2 + c * f2 + e;
    this.f = b * e2 + d * f2 + f;
    return this;
  }

  preMultiplySelf(other) {
    const next = new SimpleDOMMatrix(other).multiplySelf(this);
    Object.assign(this, next);
    return this;
  }

  translate(x = 0, y = 0) {
    return new SimpleDOMMatrix(this).translateSelf(x, y);
  }

  translateSelf(x = 0, y = 0) {
    return this.multiplySelf([1, 0, 0, 1, Number(x) || 0, Number(y) || 0]);
  }

  scale(scaleX = 1, scaleY = scaleX) {
    return new SimpleDOMMatrix(this).scaleSelf(scaleX, scaleY);
  }

  scaleSelf(scaleX = 1, scaleY = scaleX) {
    return this.multiplySelf([Number(scaleX) || 1, 0, 0, Number(scaleY) || 1, 0, 0]);
  }

  invertSelf() {
    const determinant = this.a * this.d - this.b * this.c;
    if (!determinant) {
      this.a = this.b = this.c = this.d = this.e = this.f = Number.NaN;
      return this;
    }
    const { a, b, c, d, e, f } = this;
    this.a = d / determinant;
    this.b = -b / determinant;
    this.c = -c / determinant;
    this.d = a / determinant;
    this.e = (c * f - d * e) / determinant;
    this.f = (b * e - a * f) / determinant;
    return this;
  }
}

function normalizeMatrixValues(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return [
      Number(value[0]) || 1,
      Number(value[1]) || 0,
      Number(value[2]) || 0,
      Number(value[3]) || 1,
      Number(value[4]) || 0,
      Number(value[5]) || 0,
    ];
  }
  if (value && typeof value === "object") {
    return [
      Number(value.a) || 1,
      Number(value.b) || 0,
      Number(value.c) || 0,
      Number(value.d) || 1,
      Number(value.e) || 0,
      Number(value.f) || 0,
    ];
  }
  return [1, 0, 0, 1, 0, 0];
}

function groupTextItemsIntoLines(items) {
  const lines = [];

  items.forEach((item) => {
    const str = cleanString(item.str);
    if (!str) return;

    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]) || 0;
    const y = Number(transform[5]) || 0;
    const existing = lines.find((line) => Math.abs(line.y - y) <= 2);
    const target = existing || { y, items: [] };
    target.items.push({ str, x, y });
    if (!existing) lines.push(target);
  });

  return lines.sort((a, b) => b.y - a.y);
}

function parseCustomerHeaderLine(items) {
  const accountItem = items.find((item) => isCustomerHeaderText(item.str));
  if (!accountItem) return null;

  const customerName = cleanCustomerName(
    accountItem.str
      .replace(/^.*?שם\s+חשבון:\s*/u, "")
      .replace(/,\s*מספר\s+חשבון:\s*.*$/u, ""),
  );
  if (!customerName) return null;

  const accountNumberItem = items
    .filter((item) => item !== accountItem)
    .find((item) => /^\d{3,}$/.test(cleanString(item.str)));

  return {
    customerName,
    accountNumber: cleanString(accountNumberItem?.str),
  };
}

function isCustomerHeaderText(value) {
  const normalized = cleanString(value);
  return normalized.includes("שם חשבון:") && !isAccountSummaryText(normalized);
}

function parseInvoiceLine(items) {
  const invoiceItem = items.find((item) => /^[A-Z]{2}\d{6,}$/i.test(cleanString(item.str)));
  if (!invoiceItem) return null;

  const invoiceNumber = cleanString(invoiceItem.str);
  const invoiceDate = parseReportDate(findNearestText(items, 339, isReportDate));
  const dueDate = parseReportDate(findNearestText(items, 539, isReportDate));
  const amount = findNearestMoney(items, 187, 32);
  const cumulative = findNearestMoney(items, 130, 42);
  if (!invoiceDate || amount === null) return null;

  const delayText = findNearestText(items, 514, (value) => /^\d+$/.test(cleanString(value)));
  const transactionType = cleanString(findNearestText(items, 412, (value) => /^[^\d/\s]{1,4}$/u.test(cleanString(value))));
  const details = items
    .filter((item) => item.x >= 215 && item.x <= 315)
    .sort((a, b) => b.x - a.x)
    .map((item) => item.str)
    .join(" ");

  return {
    id: `${invoiceNumber}-${invoiceDate}-${roundMoney(amount)}`,
    invoiceNumber,
    invoiceDate,
    dueDate,
    delayDays: delayText ? Number(delayText) : 0,
    transactionType,
    details: cleanString(details),
    amount: roundMoney(amount),
    cumulative: cumulative === null ? null : roundMoney(cumulative),
  };
}

function findNearestText(items, targetX, predicate) {
  const candidates = items
    .map((item) => ({ ...item, distance: Math.abs(item.x - targetX) }))
    .filter((item) => item.distance <= 36 && predicate(item.str))
    .sort((a, b) => a.distance - b.distance);
  return cleanString(candidates[0]?.str);
}

function findNearestMoney(items, targetX, tolerance) {
  const candidates = items
    .flatMap((item) =>
      [...item.str.matchAll(/-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})|-?\d+(?:\.\d{1,2})?/g)].map((match) => ({
        value: parseMoney(match[0]),
        x: item.x,
        distance: Math.abs(item.x - targetX),
      })),
    )
    .filter((item) => item.value !== null && item.distance <= tolerance)
    .sort((a, b) => a.distance - b.distance);

  return candidates[0]?.value ?? null;
}

function isReportDate(value) {
  return /^\d{2}\/\d{2}\/\d{2,4}$/.test(cleanString(value));
}

function parseReportDate(value) {
  const match = cleanString(value).match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!match) return "";
  const [, day, month, rawYear] = match;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return `${year}-${month}-${day}`;
}

function compareInvoices(a, b) {
  const dateCompare = cleanString(a.invoiceDate).localeCompare(cleanString(b.invoiceDate));
  if (dateCompare) return dateCompare;
  return cleanString(a.invoiceNumber).localeCompare(cleanString(b.invoiceNumber));
}

function parseSummaryLine(items) {
  const summaryItem = items.find((item) => isAccountSummaryText(item.str));
  if (!summaryItem) return null;

  const customerName = cleanCustomerName(summaryItem.str.replace(/^.*?סה["״]?כ\s+לשם\s+חשבון:\s*/u, ""));
  const amount = extractSummaryAmount(items, summaryItem.x);
  if (!customerName || amount === null) return null;

  return { customerName, amount: roundMoney(amount) };
}

function isAccountSummaryText(value) {
  const normalized = cleanString(value).replace(/[״"]/g, '"').replace(/\s+/g, " ");
  return /סה"?כ\s+לשם\s+חשבון:/u.test(normalized);
}

function extractSummaryAmount(items, summaryX) {
  const candidates = items
    .filter((item) => item.x < summaryX - 40)
    .flatMap((item) =>
      [...item.str.matchAll(/-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})|-?\d+(?:\.\d{1,2})?/g)].map((match) => parseMoney(match[0])),
    )
    .filter((value) => value !== null && Math.abs(value) > 0);

  if (!candidates.length) return null;
  return candidates.sort((a, b) => Math.abs(b) - Math.abs(a))[0];
}

function cleanCustomerName(value) {
  return cleanString(value)
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/\s+([,])/g, "$1");
}

function normalizeIdentity(value) {
  return cleanCustomerName(value)
    .toLocaleLowerCase("he")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function decodeBase64File(value) {
  const raw = cleanString(value).replace(/^data:.*?;base64,/, "");
  if (!raw) return new Uint8Array();
  return new Uint8Array(Buffer.from(raw, "base64"));
}

function parseMoney(value) {
  const number = Number(cleanString(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
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

function cleanString(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function sendJson(response, statusCode, data) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(data));
}

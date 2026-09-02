const HEADER_ALIASES = {
  customer: [
    ["שם לקוח", 240],
    ["לקוח", 220],
    ["customer name", 210],
    ["customer", 200],
    ["client", 190],
  ],
  sku: [
    ["מספר פריט", 250],
    ["מקט", 240],
    ["דגם", 230],
    ["sku", 220],
    ["item number", 210],
    ["part number", 205],
    ["model", 200],
    ["item", 180],
    ["part", 170],
  ],
  description: [
    ["תאור פריט", 240],
    ["תיאור פריט", 240],
    ["תאור", 220],
    ["תיאור", 220],
    ["description", 210],
    ["product description", 205],
    ["מוצר", 180],
    ["desc", 170],
    ["name", 150],
  ],
  quantity: [
    ["יתרה לאספקה", 300],
    ["כמות שנותרה", 290],
    ["יתרה משוריינת", 280],
    ["outstanding delivery", 270],
    ["delivery balance", 260],
    ["remaining quantity", 250],
    ["reservation balance", 245],
    ["יתרה", 220],
    ["כמות", 200],
    ["remaining", 190],
    ["balance", 180],
    ["quantity", 170],
    ["qty", 160],
  ],
};

function cleanCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return cleanCell(value)
    .toLocaleLowerCase("he-IL")
    .normalize("NFKD")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[״"׳']/g, "")
    .replace(/[^\p{L}\p{N}.+-]+/gu, " ")
    .trim();
}

function normalizeIdentity(value) {
  return normalizeText(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeIdentityWithSortedNumbers(value) {
  const normalized = normalizeText(value);
  const text = normalized.replace(/\d+/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  const numbers = normalized.match(/\d+/g) || [];
  return `${text}|${numbers.sort((a, b) => Number(a) - Number(b)).join("|")}`;
}

function getSkuKey(value) {
  return cleanCell(value).toLocaleUpperCase("en-US");
}

function getHeaderScore(value, field) {
  const label = normalizeText(value);
  if (!label) return -1;
  const aliases = HEADER_ALIASES[field] || [];
  const exact = aliases.find(([alias]) => label === normalizeText(alias));
  if (exact) return exact[1];

  // A phrase match is deliberately weaker than an exact match. This supports
  // vendor headers such as "יתרה לאספקה (יחידות)" without letting a generic
  // "כמות" column beat the authoritative outstanding-delivery balance.
  return aliases.reduce((best, [alias, score]) => {
    const normalizedAlias = normalizeText(alias);
    return normalizedAlias.length >= 3 && label.includes(normalizedAlias) ? Math.max(best, score - 80) : best;
  }, -1);
}

function findBestColumn(row, field) {
  const candidates = row
    .map((cell, index) => ({ index, score: getHeaderScore(cell, field), label: cleanCell(cell) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  if (!candidates.length) return { index: undefined, ambiguous: false, score: 0 };
  const top = candidates[0];
  return {
    index: top.index,
    score: top.score,
    ambiguous: candidates.length > 1 && candidates[1].score === top.score,
    candidates,
  };
}

export function detectReservationReportColumns(rows) {
  let best = null;
  rows.slice(0, 30).forEach((row, headerRowIndex) => {
    const customer = findBestColumn(row, "customer");
    const sku = findBestColumn(row, "sku");
    const description = findBestColumn(row, "description");
    const quantity = findBestColumn(row, "quantity");
    if (sku.index === undefined || quantity.index === undefined) return;
    const score = sku.score * 2 + quantity.score * 2 + customer.score + description.score * 0.25;
    if (!best || score > best.score) {
      best = {
        score,
        headerRowIndex,
        columns: {
          customer: customer.index,
          sku: sku.index,
          description: description.index,
          quantity: quantity.index,
        },
        ambiguous: sku.ambiguous || quantity.ambiguous,
      };
    }
  });

  if (!best) throw new Error("לא מצאתי בדוח עמודת דגם/מק״ט ועמודת כמות או יתרה.");
  if (best.ambiguous) {
    throw new Error("נמצאו כמה עמודות אפשריות לדגם או ליתרה באותה רמת התאמה. לא בוצע שינוי כדי למנוע ניחוש שגוי.");
  }
  return { columns: best.columns, headerRowIndex: best.headerRowIndex };
}

function getUniqueMatch(value, customers, selector) {
  const key = selector(value);
  if (!key) return { status: "unknown", customer: null };
  const matches = customers.filter((customer) => selector(customer.name) === key);
  if (matches.length === 1) return { status: "matched", customer: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", customer: null, matches };
  return { status: "unknown", customer: null };
}

export function resolveReservationCustomer(name, customers) {
  const tiers = [normalizeText, normalizeIdentity, normalizeIdentityWithSortedNumbers];
  for (const selector of tiers) {
    const result = getUniqueMatch(name, customers, selector);
    if (result.status !== "unknown") return result;
  }
  return { status: "unknown", customer: null };
}

function parseStrictQuantity(value) {
  if (value === null || value === undefined || cleanCell(value) === "") return null;
  const normalized = typeof value === "number" ? value : Number(cleanCell(value).replace(/,/g, ""));
  if (!Number.isFinite(normalized) || normalized < 0 || !Number.isInteger(normalized)) return null;
  return normalized;
}

function getMetadataCustomerName(rows, headerRowIndex) {
  for (const row of rows.slice(0, headerRowIndex)) {
    const labelIndex = row.findIndex((cell) => getHeaderScore(cell, "customer") >= 0);
    if (labelIndex < 0) continue;
    const customerName = cleanCell(row[labelIndex + 1]);
    if (customerName) return customerName;
  }
  return "";
}

function getDeclaredUnitTotal(rows, headerRowIndex) {
  for (const row of rows.slice(0, headerRowIndex)) {
    const labelIndex = row.findIndex((cell) => {
      const label = normalizeText(cell).replace(/[^\p{L}\p{N}]/gu, "");
      return label.includes("סהכיחידות") || label.includes("totalunits");
    });
    if (labelIndex < 0) continue;
    for (const cell of row.slice(labelIndex + 1)) {
      const value = parseStrictQuantity(cell);
      if (value !== null) return value;
    }
  }
  return null;
}

function addIssue(issues, issue) {
  issues.push({
    rowNumber: issue.rowNumber || 0,
    type: issue.type || "invalid-row",
    customerId: cleanCell(issue.customerId),
    customerName: cleanCell(issue.customerName),
    sku: cleanCell(issue.sku),
    message: cleanCell(issue.message),
  });
}

export function parseReservationReportRows(rows, options = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("לא נמצאו שורות בדוח השריונים.");
  const customers = Array.isArray(options.customers) ? options.customers : [];
  const selectedCustomer = customers.find((customer) => customer.id === options.selectedCustomerId) || null;
  const { columns, headerRowIndex } = detectReservationReportColumns(rows);
  const reportCustomerName = getMetadataCustomerName(rows, headerRowIndex);
  const reportCustomerResolution = reportCustomerName
    ? resolveReservationCustomer(reportCustomerName, customers)
    : { status: "unknown", customer: null };
  const fallbackCustomer = reportCustomerResolution.status === "matched" ? reportCustomerResolution.customer : selectedCustomer;

  if (columns.customer === undefined && !fallbackCustomer) {
    if (reportCustomerResolution.status === "ambiguous") {
      throw new Error("שם הלקוח שבכותרת מתאים ליותר מלקוח אחד. לא בוצע שינוי כדי למנוע שיוך שגוי.");
    }
    throw new Error("לא נמצא לקוח בדוח. בחר לקוח במסנן לפני העלאת קובץ ללא עמודת לקוח.");
  }

  const metadata = rows.slice(0, headerRowIndex).flat().map(cleanCell).filter(Boolean).join(" ");
  const headerLabels = (rows[headerRowIndex] || []).map(normalizeText).filter(Boolean);
  const isOutstandingDeliveryReport =
    columns.customer !== undefined &&
    headerLabels.some((label) => ["יתרה לאספקה", "outstanding delivery", "delivery balance"].some((term) => label.includes(normalizeText(term))));
  const isFullReport = normalizeText(metadata).includes(normalizeText("דוח מלאי משוריין")) || isOutstandingDeliveryReport;
  const declaredTotal = getDeclaredUnitTotal(rows, headerRowIndex);

  const entries = new Map();
  const issues = [];
  const seenCustomerIds = new Set();
  const protectedCustomerIds = new Set();
  const protectedCustomerNames = new Set();
  let sourceRowCount = 0;
  let acceptedRowCount = 0;
  let totalQuantity = 0;

  rows.slice(headerRowIndex + 1).forEach((row, offset) => {
    if (!row.some((cell) => cleanCell(cell))) return;
    sourceRowCount += 1;
    const rowNumber = headerRowIndex + offset + 2;
    const sku = cleanCell(row[columns.sku]);
    const skuKey = getSkuKey(sku);
    const quantity = parseStrictQuantity(row[columns.quantity]);
    const customerName = columns.customer === undefined ? fallbackCustomer?.name || "" : cleanCell(row[columns.customer]);
    const resolution = columns.customer === undefined
      ? { status: "matched", customer: fallbackCustomer }
      : resolveReservationCustomer(customerName, customers);

    if (resolution.status !== "matched") {
      addIssue(issues, {
        rowNumber,
        type: resolution.status === "ambiguous" ? "ambiguous-customer" : "unknown-customer",
        customerName,
        sku,
        message: resolution.status === "ambiguous" ? "שם הלקוח אינו חד־משמעי" : "הלקוח לא נמצא במערכת",
      });
      return;
    }

    const customer = resolution.customer;
    seenCustomerIds.add(customer.id);
    if (!skuKey || quantity === null) {
      protectedCustomerIds.add(customer.id);
      protectedCustomerNames.add(customer.name);
      addIssue(issues, {
        rowNumber,
        type: !skuKey ? "missing-sku" : "invalid-quantity",
        customerId: customer.id,
        customerName: customer.name,
        sku,
        message: !skuKey ? "חסר דגם/מק״ט" : "הכמות חייבת להיות מספר שלם שאינו שלילי",
      });
      return;
    }

    acceptedRowCount += 1;
    totalQuantity += quantity;
    const key = `${customer.id}|${skuKey}`;
    const current = entries.get(key) || {
      customer,
      sku,
      skuKey,
      description: columns.description === undefined ? "" : cleanCell(row[columns.description]),
      quantity: 0,
      sourceRows: [],
    };
    current.quantity += quantity;
    current.sourceRows.push(rowNumber);
    if (!current.description && columns.description !== undefined) current.description = cleanCell(row[columns.description]);
    entries.set(key, current);
  });

  if (!entries.size) throw new Error("לא נמצאו בדוח שורות תקינות עם דגם וכמות עבור לקוחות קיימים.");

  if (declaredTotal !== null && declaredTotal !== totalQuantity) {
    const affectedCustomers = fallbackCustomer ? [fallbackCustomer] : [...seenCustomerIds].map((id) => customers.find((customer) => customer.id === id)).filter(Boolean);
    affectedCustomers.forEach((customer) => {
      protectedCustomerIds.add(customer.id);
      protectedCustomerNames.add(customer.name);
    });
    addIssue(issues, {
      type: "declared-total-mismatch",
      customerId: fallbackCustomer?.id,
      customerName: fallbackCustomer?.name || reportCustomerName,
      message: `סך היחידות בכותרת הוא ${declaredTotal}, אך בשורות התקינות נספרו ${totalQuantity}`,
    });
  }

  return {
    entries: [...entries.values()],
    issues,
    invalidRows: issues.filter((issue) => ["missing-sku", "invalid-quantity"].includes(issue.type)).map((issue) => issue.rowNumber),
    skippedCustomerNames: [...new Set(issues.filter((issue) => issue.type === "unknown-customer").map((issue) => issue.customerName).filter(Boolean))],
    ambiguousCustomerNames: [...new Set(issues.filter((issue) => issue.type === "ambiguous-customer").map((issue) => issue.customerName).filter(Boolean))],
    protectedCustomerIds: [...protectedCustomerIds],
    protectedCustomerNames: [...protectedCustomerNames],
    seenCustomerIds: [...seenCustomerIds],
    sourceRowCount,
    acceptedRowCount,
    totalQuantity,
    declaredTotal,
    isFullReport,
  };
}

export function getReservationReportSignature(report) {
  const entries = report.entries
    .map((entry) => [entry.customer.id, entry.skuKey, entry.description, entry.quantity, ...(entry.sourceRows || [])].join("|"))
    .sort()
    .join("\n");
  const issues = (report.issues || [])
    .map((issue) => [issue.rowNumber, issue.type, issue.customerId, issue.customerName, issue.sku, issue.message].join("|"))
    .sort()
    .join("\n");
  return [
    report.isFullReport,
    report.sourceRowCount,
    report.acceptedRowCount,
    report.totalQuantity,
    report.declaredTotal ?? "",
    [...(report.protectedCustomerIds || [])].sort().join("|"),
    entries,
    issues,
  ].join("\n---\n");
}

export function verifyReservationReportPasses(reports) {
  const [first, ...remaining] = reports;
  if (!first || remaining.some((report) => getReservationReportSignature(report) !== getReservationReportSignature(first))) {
    throw new Error("בדיקת הדוח המשולשת לא התאימה. לא בוצע שינוי בשריונים.");
  }
  return first;
}

export function createReservationImportPlan(existingReservations, report) {
  const protectedCustomerIds = new Set(report.protectedCustomerIds || []);
  const safeEntries = report.entries.filter((entry) => !protectedCustomerIds.has(entry.customer.id));
  const replacementCustomerIds = report.isFullReport
    ? new Set((report.seenCustomerIds || []).filter((customerId) => !protectedCustomerIds.has(customerId)))
    : new Set();
  const safeKeys = new Set(safeEntries.map((entry) => `${entry.customer.id}|${entry.skuKey}`));
  const existingByKey = new Map(existingReservations.map((item) => [`${item.customerId}|${item.skuKey}`, item]));
  const keptReservations = report.isFullReport
    ? existingReservations.filter((item) => !replacementCustomerIds.has(item.customerId))
    : existingReservations.filter((item) => !safeKeys.has(`${item.customerId}|${item.skuKey}`));
  const removed = report.isFullReport
    ? existingReservations.filter((item) => replacementCustomerIds.has(item.customerId) && !safeKeys.has(`${item.customerId}|${item.skuKey}`)).length
    : 0;
  return {
    safeEntries,
    keptReservations,
    replacementCustomerIds: [...replacementCustomerIds],
    protectedCustomerIds: [...protectedCustomerIds],
    updated: safeEntries.filter((entry) => existingByKey.has(`${entry.customer.id}|${entry.skuKey}`)).length,
    added: safeEntries.filter((entry) => !existingByKey.has(`${entry.customer.id}|${entry.skuKey}`)).length,
    removed,
    isolatedRows: (report.issues || []).filter((issue) => issue.rowNumber > 0).length,
  };
}

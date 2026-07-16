import { createRequire } from "node:module";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const baseUrl = process.argv[2] || process.env.BASE_URL || "http://localhost:5173/";
const appUrl = new URL(baseUrl);
const isLocalHost = ["localhost", "127.0.0.1"].includes(appUrl.hostname);
appUrl.searchParams.set("local", "1");
if (isLocalHost) appUrl.searchParams.set("skipAuth", "1");
const preferredWorkbookPath = process.env.WORKBOOK_PATH || "/Users/adamspanko/Downloads/מחירון יוני +אחוזים.xlsx";
const screenshotPath = new URL("../verification/mobile.png", import.meta.url);
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

await mkdir(new URL("../verification/", import.meta.url), { recursive: true });
const workbookPath = await resolveWorkbookPath(preferredWorkbookPath);

const launchOptions = { headless: true, args: ["--no-first-run"] };
try {
  await access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {
  // Fall back to Playwright's managed browser when it is installed.
}

const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: "block",
});
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.clear();
  window.__openedWhatsApp = "";
  window.open = (url) => {
    window.__openedWhatsApp = String(url || "");
    return null;
  };
});

const errors = [];
page.on("dialog", (dialog) => dialog.accept());
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

errors.length = 0;
await page.goto(appUrl.toString(), { waitUntil: "networkidle" });
if (!isLocalHost) {
  await page.getByRole("heading", { name: "מחירון והזמנות" }).waitFor();
  await page.locator("#pinInput").fill("1221");
  await page.locator("#rememberMe").check();
  await page.locator("#loginButton").click();
  await page.locator("#appShell").waitFor({ state: "visible" });
  await page.reload({ waitUntil: "networkidle" });
}
await page.getByRole("heading", { name: "מחירון והזמנות" }).waitFor();
await page.waitForFunction(() => document.querySelector("#metadata")?.textContent.includes("127"));

const initialMeta = await page.locator("#metadata").innerText();
if (!initialMeta.includes("127")) {
  throw new Error(`Expected 127 default products, got metadata: ${initialMeta}`);
}

await page.locator("#searchInput").fill("FJ-32");
await page.locator(".result-row").first().waitFor();
const firstResult = await page.locator(".result-row").first().innerText();
if (!firstResult.includes("FJ-32UIL900") || !firstResult.includes("475")) {
  throw new Error(`Unexpected search result: ${firstResult}`);
}

await page.locator('[data-tab="categories"]').click();
await page.locator("#categoryInput").fill("מקפיא תחתון");
await page.locator("#addCategory").click();
await page.locator("#categoryProductSearch").fill("IT-CF244");
await page.locator("[data-manage-product-category]").first().selectOption("מקפיא תחתון");
await page.locator('[data-tab="search"]').click();
await page.locator("#searchInput").fill("IT-CF244");
await page.locator(".result-row").first().waitFor();
await page.locator("[data-edit-product-note]").first().click();
await page.locator("#noteInput").fill("לבדוק זמינות לפני סגירה");
await page.locator("#noteForm").getByRole("button", { name: "שמור הערה" }).click();

await page.locator('[data-tab="categories"]').click();
await page.locator("#categoryInput").fill("יצא מהמהגוון");
await page.locator("#addCategory").click();
await page.locator("#categoryProductSearch").fill("FJ-B957E");
await page.locator("[data-manage-product-category]").first().selectOption("יצא מהמהגוון");
await page.locator('[data-tab="search"]').click();
await page.locator("#searchInput").fill("FJ-B957E");
const discontinuedResult = page.locator(".result-row").first();
if (
  !(await discontinuedResult.evaluate((node) => node.classList.contains("discontinued-product"))) ||
  (await discontinuedResult.locator("[data-add-to-cart]").count()) !== 0 ||
  (await discontinuedResult.locator("[data-add-quantity]").count()) !== 0 ||
  !(await discontinuedResult.innerText()).includes("לא ניתן להזמנה")
) {
  throw new Error(`Expected discontinued product to be blocked: ${await discontinuedResult.innerText()}`);
}
await page.locator('[data-tab="categories"]').click();
await page.locator("#categoryProductSearch").fill("FJ-B957E");
await page.locator("[data-manage-product-category]").first().selectOption("");
await page.locator('[data-tab="search"]').click();

await page.locator("#fileInput").setInputFiles(workbookPath);
await page.waitForFunction(() => !document.querySelector("#status")?.textContent.includes("מעדכן"));
const importStatus = await page.locator("#status").innerText();
if (!importStatus.includes("עודכנו 127")) {
  throw new Error(`Expected import success, got status: ${importStatus}`);
}
await page.locator("#searchInput").fill("IT-CF244");
const importedResult = await page.locator(".result-row").first().innerText();
if (!importedResult.includes("IT-CF244") || !importedResult.includes("690")) {
  throw new Error(`Unexpected imported search result: ${importedResult}`);
}
if (!importedResult.includes("מקפיא תחתון") || !importedResult.includes("לבדוק זמינות לפני סגירה")) {
  throw new Error(`Annotation did not persist: ${importedResult}`);
}

await addFirstResultToCart(page, "משה חיון", { quantity: 2, price: 120 });
await addFirstResultToCart(page, "משה חיון", { inline: true, quantity: 1, price: 120 });
await page.locator("#floatingCart").click();
const promptedCustomerName = await page.locator("#customerName").inputValue();
if (promptedCustomerName !== "משה חיון") {
  throw new Error(`Expected prompted customer to be selected, got: ${promptedCustomerName}`);
}
await page.locator("#clearCart").click();
if ((await page.locator("#customerName").inputValue()) !== "") {
  throw new Error("Expected customer name to clear with the cart.");
}
await page.locator('[data-tab="search"]').click();
await page.locator("#searchInput").fill("IT-CF244");

await page.locator('[data-tab="customers"]').click();
await page.locator("#customersList").getByText("משה חיון").waitFor();
await page.locator("#customerCode").fill("C-100");
await page.locator("#customerFormName").fill("לקוח בדיקה");
await page.locator("#customerPhone").fill("0509998888");
await page.locator("#saveCustomer").click();
await page.locator("#customerSearch").fill("לקוח בדיקה");
await page.locator(".customer-card").filter({ hasText: "לקוח בדיקה" }).waitFor();
await page.locator(".customer-card").filter({ hasText: "לקוח בדיקה" }).locator("[data-choose-customer]").click();
const selectedCustomerName = await page.locator("#customerName").inputValue();
if (selectedCustomerName !== "לקוח בדיקה") {
  throw new Error(`Expected selected customer, got: ${selectedCustomerName}`);
}

const addItemsButton = page.locator("#cartItems [data-add-cart-items]");
await addItemsButton.waitFor();
await addItemsButton.click();
await page.locator('[data-tab-panel="search"].active').waitFor();
await page.locator("#searchInput").fill("IT-CF244");
await addFirstResultToCart(page, "לקוח בדיקה", { inline: true, quantity: 3, price: 39 });
const floatingCartText = await page.locator("#floatingCart").innerText();
if (!floatingCartText.includes("3") || !floatingCartText.includes("117")) {
  throw new Error(`Unexpected floating cart after add: ${floatingCartText}`);
}
await page.locator("#floatingCart").click();
await page.locator(".cart-line").first().waitFor();
await page.locator("#whatsappNumber").fill("0501234567");
await page.locator("#whatsappNumber").evaluate((node) => node.dispatchEvent(new Event("change", { bubbles: true })));
const currentWhatsAppHref = await page.locator("#sendWhatsApp").getAttribute("href");
const currentWhatsAppText = decodeURIComponent(currentWhatsAppHref || "");
if (
  !currentWhatsAppHref?.includes("https://wa.me/972501234567") ||
  !currentWhatsAppText.includes("לקוח בדיקה") ||
  !currentWhatsAppText.includes("3 יחידות") ||
  !currentWhatsAppText.includes("(IT-CF244) לפי 39 ש״ח") ||
  currentWhatsAppText.includes("מקפיא מסחרי") ||
  !currentWhatsAppText.includes("סה״כ הזמנה: 117 ש״ח")
) {
  throw new Error(`Unexpected current WhatsApp link: ${currentWhatsAppHref}`);
}
const currentSkuOccurrences = currentWhatsAppText.match(/IT-CF244/g)?.length || 0;
if (currentSkuOccurrences !== 1) {
  throw new Error(`Expected SKU once in current WhatsApp message, got ${currentSkuOccurrences}: ${currentWhatsAppText}`);
}

await page.locator("#sendWhatsApp").click();
await page.locator("#ordersList .order-card").first().waitFor();
const openedWhatsApp = await page.evaluate(() => window.__openedWhatsApp);
if (!openedWhatsApp.includes("https://wa.me/972501234567")) {
  throw new Error(`Expected WhatsApp to open after saving, got: ${openedWhatsApp}`);
}
const savedOrder = await page.locator("#ordersList .order-card").first().innerText();
if (!savedOrder.includes("לקוח בדיקה") || (!savedOrder.includes("IT-CF244") && !savedOrder.includes("מקפיא מסחרי"))) {
  throw new Error(`Unexpected saved order: ${savedOrder}`);
}
const savedOrderCard = page.locator("#ordersList .order-card").first();
if ((await savedOrderCard.locator("[data-load-order]").count()) !== 0) {
  throw new Error("Did not expect a load-to-cart button in the orders tab.");
}
await savedOrderCard.locator("[data-toggle-order-details]").click();
const savedOrderDetails = await savedOrderCard.locator(".order-text-details").innerText();
if (!savedOrderDetails.includes("3 יחידות (IT-CF244) לפי 39 ש״ח") || !savedOrderDetails.includes("סה״כ הזמנה: 117 ש״ח")) {
  throw new Error(`Unexpected expanded order text: ${savedOrderDetails}`);
}
const orderWhatsAppHref = await page.locator("#ordersList .order-card .whatsapp-button").first().getAttribute("href");
const orderWhatsAppText = decodeURIComponent(orderWhatsAppHref || "");
if (
  !orderWhatsAppHref?.includes("https://wa.me/972501234567") ||
  !orderWhatsAppText.includes("לקוח בדיקה") ||
  !orderWhatsAppText.includes("3 יחידות") ||
  !orderWhatsAppText.includes("(IT-CF244) לפי 39 ש״ח") ||
  orderWhatsAppText.includes("מקפיא מסחרי") ||
  !orderWhatsAppText.includes("סה״כ הזמנה: 117 ש״ח")
) {
  throw new Error(`Unexpected order WhatsApp link: ${orderWhatsAppHref}`);
}
const orderSkuOccurrences = orderWhatsAppText.match(/IT-CF244/g)?.length || 0;
if (orderSkuOccurrences !== 1) {
  throw new Error(`Expected SKU once in saved WhatsApp message, got ${orderSkuOccurrences}: ${orderWhatsAppText}`);
}

await page.locator('[data-tab="customers"]').click();
await page.locator("#customerSearch").fill("לקוח בדיקה");
const customerCard = page.locator(".customer-card").filter({ hasText: "לקוח בדיקה" });
await customerCard.waitFor();
const customerCardText = await customerCard.innerText();
if (!customerCardText.includes("כל הזמנים") || !customerCardText.includes("החודש") || !customerCardText.includes("117")) {
  throw new Error(`Expected customer totals, got: ${customerCardText}`);
}
await customerCard.locator("[data-view-customer-orders]").click();
const customerOrder = page.locator("#customerOrders .customer-order-details").first();
await customerOrder.locator("summary").click();
const customerHistory = await page.locator("#customerOrders").innerText();
if (
  !customerHistory.includes("כל הזמנים") ||
  !customerHistory.includes("החודש") ||
  !customerHistory.includes("117") ||
  !customerHistory.includes("IT-CF244") ||
  !customerHistory.includes("מקפיא מסחרי") ||
  !customerHistory.includes("3 ×")
) {
  throw new Error(`Expected expanded customer order history, got: ${customerHistory}`);
}

await page.locator('[data-tab="search"]').click();
await addFirstResultToCart(page, "לקוח בדיקה", { expectedDefaultPrice: 690, expectLastPriceOption: 39 });
await page.locator("#floatingCart").click();
const reusedPrice = await page.locator("[data-cart-price]").first().inputValue();
if (Number(reusedPrice) !== 690) {
  throw new Error(`Expected current list price 690, got: ${reusedPrice}`);
}
const lastPriceWhatsAppText = decodeURIComponent((await page.locator("#sendWhatsApp").getAttribute("href")) || "");
if (
  !lastPriceWhatsAppText.includes("1 יחידה") ||
  !lastPriceWhatsAppText.includes("לפי 690 ש״ח") ||
  lastPriceWhatsAppText.includes("לפי מחיר אחרון")
) {
  throw new Error(`Expected list price label in WhatsApp message, got: ${lastPriceWhatsAppText}`);
}

await page.locator("#clearCart").click();
if ((await page.locator("#customerName").inputValue()) !== "") {
  throw new Error("Expected customer name to clear after clearing a reused cart.");
}
await page.locator('[data-tab="orders"]').click();
await page.locator("#ordersList [data-delete-order]").first().click();
await page.getByText("אין הזמנות שמורות עדיין.").waitFor();
await page.locator('[data-tab="search"]').click();
await addFirstResultToCart(page, "לקוח בדיקה");
await page.locator("#floatingCart").click();
const resetPrice = await page.locator("[data-cart-price]").first().inputValue();
if (Number(resetPrice) !== 690) {
  throw new Error(`Expected list price after deleting order, got: ${resetPrice}`);
}

await page.screenshot({ path: screenshotPath.pathname, fullPage: true });
await browser.close();

if (errors.length) {
  throw new Error(`Browser console errors: ${errors.join(" | ")}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      initialMeta,
      firstResult,
      importedResult,
      screenshot: screenshotPath.pathname,
    },
    null,
    2,
  ),
);

async function addFirstResultToCart(page, customerName, options = {}) {
  const dialog = page.locator("#cartCustomerDialog");
  if (options.inline) {
    const quantityInput = page.locator("[data-add-quantity]").first();
    const priceInput = page.locator("[data-add-price]").first();
    await quantityInput.waitFor();
    if ((await quantityInput.inputValue()) !== "1") {
      throw new Error(`Expected inline default quantity 1, got ${await quantityInput.inputValue()}`);
    }
    if (options.quantity !== undefined) await quantityInput.fill(String(options.quantity));
    if (options.price !== undefined) await priceInput.fill(String(options.price));
    await page.locator("[data-add-to-cart]").first().click();
    if (await dialog.isVisible()) throw new Error("Did not expect the customer dialog after a customer was selected.");
    await page.locator("#floatingCart").waitFor();
    return;
  }

  await page.locator("[data-add-to-cart]").first().click();
  await dialog.waitFor({ state: "visible" });
  const defaultQuantity = await page.locator("#cartProductQuantity").inputValue();
  if (defaultQuantity !== "1") throw new Error(`Expected default quantity 1, got ${defaultQuantity}`);
  if (options.expectedDefaultPrice !== undefined) {
    const defaultPrice = Number(await page.locator("#cartProductPrice").inputValue());
    if (defaultPrice !== options.expectedDefaultPrice) {
      throw new Error(`Expected default list price ${options.expectedDefaultPrice}, got ${defaultPrice}`);
    }
  }
  if (options.expectLastPriceOption !== undefined) {
    const quickPrices = await page.locator("#cartProductQuickPrices").innerText();
    if (!quickPrices.includes(String(options.expectLastPriceOption))) {
      throw new Error(`Expected last price option ${options.expectLastPriceOption}, got: ${quickPrices}`);
    }
  }
  await page.locator("#cartCustomerInput").fill(customerName);
  if (options.quantity !== undefined) await page.locator("#cartProductQuantity").fill(String(options.quantity));
  if (options.price !== undefined) await page.locator("#cartProductPrice").fill(String(options.price));
  await page.locator("#confirmCartCustomer").click();
  await dialog.waitFor({ state: "hidden" });

  await page.locator('[data-tab-panel="search"].active').waitFor();
  await page.locator("#floatingCart").waitFor();
}

async function resolveWorkbookPath(path) {
  try {
    await access(path);
    return path;
  } catch {
    const generatedPath = join(await mkdtemp(join(tmpdir(), "price-search-verify-")), "products.xlsx");
    const productsJson = JSON.parse(await readFile(new URL("../public/products.json", import.meta.url), "utf8"));
    const products = productsJson.products || productsJson;
    const rows = [
      ["מקט", "תיאור", "מחיר כולל מעמ"],
      ...products.map((product) => [product.sku, product.description, product.price]),
    ];
    await writeFile(generatedPath, createWorkbook(rows));
    return generatedPath;
  }
}

function createWorkbook(rows) {
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    "xl/worksheets/sheet1.xml": createWorksheet(rows),
  };

  return Buffer.from(
    zipSync(
      Object.fromEntries(Object.entries(files).map(([path, content]) => [path, strToU8(content)])),
      { level: 6 },
    ),
  );
}

function createWorksheet(rows) {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map((cell, columnIndex) => createCell(columnIndex, rowNumber, cell))
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function createCell(columnIndex, rowNumber, value) {
  const ref = `${columnName(columnIndex)}${rowNumber}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }

  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function columnName(index) {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

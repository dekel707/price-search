import "./styles.css";
import { readSheet } from "read-excel-file/browser";
import { strToU8, zipSync } from "fflate";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { createWorker } from "tesseract.js";
import { DEFAULT_RESERVATION_GROUPS, RESERVATION_SEED_VERSION } from "./reservations-data.js";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const STORAGE_KEY = "price-search-products-v1";
const META_KEY = "price-search-meta-v1";
const CATEGORIES_KEY = "price-search-categories-v1";
const ANNOTATIONS_KEY = "price-search-annotations-v1";
const CART_KEY = "price-search-cart-v1";
const ORDERS_KEY = "price-search-orders-v1";
const DRAFTS_KEY = "price-search-drafts-v1";
const SETTINGS_KEY = "price-search-settings-v1";
const CUSTOMERS_KEY = "price-search-customers-v1";
const LAST_PRICES_KEY = "price-search-last-prices-v1";
const RESERVATIONS_KEY = "price-search-reservations-v1";
const RESERVATION_SEED_KEY = "price-search-reservation-seed-v1";
const REMINDERS_KEY = "price-search-reminders-v1";
const COLLECTIONS_KEY = "price-search-collections-v1";
const ACTIVE_TAB_KEY = "price-search-active-tab-v1";
const ORDER_TYPE_KEY = "price-search-order-type-v1";
const ORDER_REPORT_TOMORROW_KEY = "price-search-order-report-tomorrow-v1";
const ORDER_REPORT_TODAY_KEY = "price-search-order-report-today-v1";
const MAX_RESULTS = 80;
const INITIAL_RESULTS = 24;
const DISPLAY_DISCOUNT_RATE = 0.15;
const VAT_RATE = 0.18;
const ORDER_REPORT_CUTOFF_HOUR = 15;
const MAX_ORDER_IMPORT_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_ORDER_IMPORT_OCR_PAGES = 8;
const MAX_ORDER_IMPORT_OCR_PIXELS = 8 * 1024 * 1024;
const ORDER_COMPLETION_MIGRATION_VERSION = 1;
const ORDER_OPEN_RESTORE_MIGRATION_VERSION = 2;
const ORDER_IMPORT_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
const GENERAL_PRODUCT = { sku: "כללי", description: "מוצר כללי", price: 0 };
const CLOUD_STATE_ENDPOINT = "/api/state";
const AUTH_ENDPOINT = "/api/auth";
const COLLECTION_IMPORT_ENDPOINT = "/api/import-collections";
const AI_ORDER_ENDPOINT = "/api/ai-order";
const ZMANIM_ENDPOINT = "/api/zmanim";
const SPEC_MANIFEST_ENDPOINT = "/specs.json";
const URL_PARAMS = new URLSearchParams(window.location.search);
const CLOUD_SYNC_DISABLED = URL_PARAMS.has("local");
const AUTH_DISABLED =
  CLOUD_SYNC_DISABLED && URL_PARAMS.has("skipAuth") && ["localhost", "127.0.0.1"].includes(window.location.hostname);

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const monthFormatter = new Intl.DateTimeFormat("he-IL", {
  month: "long",
  year: "numeric",
});
const israelDateTimeFormatter = new Intl.DateTimeFormat("he-IL", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Jerusalem",
});
const israelWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "Asia/Jerusalem",
});
const hebrewCalendarPartsFormatter = new Intl.DateTimeFormat("he-IL-u-ca-hebrew-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Jerusalem",
});

const DEFAULT_CUSTOMER_NAMES = [
  "משה חיון",
  "א.י .כתר אלקטריק בע\"מ",
  "אולשופ (אהרון חיים)",
  "אליהו רפאלי",
  "אלקטרו ע.ב.ד ג'סר בע\"מ",
  "אלקטרו רודי בע\"מ",
  "אלקטריק גוונים בע\"מ",
  "אלקטריקס חשמל ומטבחים בע\"מ",
  "אמיר הנדסה",
  "ארז מזור טכנולוגיות בע\"מ",
  "בטרשופ בע\"מ",
  "בן משה מנחם",
  "בקשי שווק (זוהר בקשי(",
  "גואן סטלייט",
  "גל אלקטריק (ששון ציון(",
  "דניאל שיווק והפצה בע\"מ",
  "המקלט אילן מזרחי מוצרי חשמל ואלקטרוניקה",
  "חברת בני פתחי חושאן בע\"מ",
  "חשמל המזרח התיכון (עלא עבד אלחלים(",
  "חשמל וואיל",
  "חשמל מאור הגליל((2012בע\"מ חץ וחדש",
  "חשמל פ.אלאמין בע\"מ",
  "טופ אלקטריק נצרת (מאהר נאסר(",
  "טלסטאר נהריה (אילנה אפריאט(",
  "יוסי חשמל ואלקטרוניקה",
  "יצחק פרידברג מרכז המקררים בע\"מ",
  "כל בו אחים סמארה ש .בע\"מ",
  "ליעם אלקטריק בע\"מ",
  "מאגרי חשמל מ.ש בע\"מ",
  "מוכתאר 2ליבוא ושיווק (מאופק חמודי(",
  "מלון האחוזה ונוס בע\"מ",
  "מרכז החשמל סספורטס בע\"מ",
  "נ.ד.ע.א מוצרי חשמל בע\"מ",
  "ס.א.פ שיווק מוצרי חשמל בע\"מ",
  "סוהיל דאמוני בע\"מ",
  "סט כרמיאל בע\"מ",
  "סל-תק",
  "סלון קזז בע\"מ",
  "סמארט טו ביי",
  "סמי אלקטריק מוצרי צריכה בע\"מ",
  "עדיני עלא למוצרי חשמל בע\"מ",
  "עדנאן הנדסה בע\"מ",
  "עילוט לחשמל בע\"מ",
  "פדאא חברה לחשמל ורהיטים בע\"מ",
  "פואז עזאיזה ובניו בע\"מ",
  "פז מבואות נצרת דלק בילאל",
  "צ.י טכנוקור בע\"מ",
  "קאנא אל גליל ( 2007 (99בע\"מ",
  "קבוצת אלמוג כסים א.י.ל בע\"מ",
  "ש.א.אוראל אלקטרוניקה בע\"מ",
  "ש.מ.חביש בע\"מ",
  "שפיק מ.ספורי -חשמל אלמוסטפע (ספורי שפיק(",
  "תורג'מן יעקב מוצרי חשמל",
];

const dom = {
  authGate: document.querySelector("#authGate"),
  authForm: document.querySelector("#authForm"),
  pinInput: document.querySelector("#pinInput"),
  rememberMe: document.querySelector("#rememberMe"),
  loginButton: document.querySelector("#loginButton"),
  authError: document.querySelector("#authError"),
  appShell: document.querySelector("#appShell"),
  ownerStatus: document.querySelector("#ownerStatus"),
  headerReminders: document.querySelector("#headerReminders"),
  headerRemindersBadge: document.querySelector("#headerRemindersBadge"),
  tabButtons: [...document.querySelectorAll("[data-tab]")],
  tabPanels: [...document.querySelectorAll("[data-tab-panel]")],
  searchInput: document.querySelector("#searchInput"),
  clearSearch: document.querySelector("#clearSearch"),
  fileInput: document.querySelector("#fileInput"),
  resetData: document.querySelector("#resetData"),
  stockFileInput: document.querySelector("#stockFileInput"),
  categoryFilter: document.querySelector("#categoryFilter"),
  categoryInput: document.querySelector("#categoryInput"),
  addCategory: document.querySelector("#addCategory"),
  categoriesList: document.querySelector("#categoriesList"),
  categoryProductSearch: document.querySelector("#categoryProductSearch"),
  categoryProductsList: document.querySelector("#categoryProductsList"),
  customerName: document.querySelector("#customerName"),
  customerOptions: document.querySelector("#customerOptions"),
  customerHint: document.querySelector("#customerHint"),
  orderImportInput: document.querySelector("#orderImportInput"),
  orderImportStatus: document.querySelector("#orderImportStatus"),
  orderImportDialog: document.querySelector("#orderImportDialog"),
  orderImportReview: document.querySelector("#orderImportReview"),
  orderImportCustomerName: document.querySelector("#orderImportCustomerName"),
  orderImportCustomerPhone: document.querySelector("#orderImportCustomerPhone"),
  confirmOrderImport: document.querySelector("#confirmOrderImport"),
  cancelOrderImport: document.querySelector("#cancelOrderImport"),
  cancelOrderImportTop: document.querySelector("#cancelOrderImportTop"),
  cartPanel: document.querySelector(".cart-panel"),
  cartTitle: document.querySelector("#cartTitle"),
  orderTypeInputs: [...document.querySelectorAll('[name="orderType"]')],
  reportTomorrow: document.querySelector("#reportTomorrow"),
  reportToday: document.querySelector("#reportToday"),
  cartCustomerDialog: document.querySelector("#cartCustomerDialog"),
  cartCustomerForm: document.querySelector("#cartCustomerForm"),
  cartCustomerInput: document.querySelector("#cartCustomerInput"),
  cartCustomerOptions: document.querySelector("#cartCustomerOptions"),
  cartCustomerFeedback: document.querySelector("#cartCustomerFeedback"),
  pendingProductSummary: document.querySelector("#pendingProductSummary"),
  cartProductQuantity: document.querySelector("#cartProductQuantity"),
  cartProductPriceLabel: document.querySelector("#cartProductPriceLabel"),
  cartProductPrice: document.querySelector("#cartProductPrice"),
  cartProductQuickPrices: document.querySelector("#cartProductQuickPrices"),
  dialogPromotionOption: document.querySelector("#dialogPromotionOption"),
  cartProductPromotion: document.querySelector("#cartProductPromotion"),
  dialogReservationOption: document.querySelector("#dialogReservationOption"),
  cartProductReservation: document.querySelector("#cartProductReservation"),
  dialogReservationLabel: document.querySelector("#dialogReservationLabel"),
  cancelCartCustomer: document.querySelector("#cancelCartCustomer"),
  cancelCartCustomerTop: document.querySelector("#cancelCartCustomerTop"),
  noteDialog: document.querySelector("#noteDialog"),
  noteForm: document.querySelector("#noteForm"),
  noteProductSummary: document.querySelector("#noteProductSummary"),
  noteInput: document.querySelector("#noteInput"),
  deleteNote: document.querySelector("#deleteNote"),
  cancelNote: document.querySelector("#cancelNote"),
  cancelNoteTop: document.querySelector("#cancelNoteTop"),
  arrivalDialog: document.querySelector("#arrivalDialog"),
  arrivalForm: document.querySelector("#arrivalForm"),
  arrivalProductSummary: document.querySelector("#arrivalProductSummary"),
  arrivalDateInput: document.querySelector("#arrivalDateInput"),
  deleteArrival: document.querySelector("#deleteArrival"),
  cancelArrival: document.querySelector("#cancelArrival"),
  cancelArrivalTop: document.querySelector("#cancelArrivalTop"),
  whatsappNumber: document.querySelector("#whatsappNumber"),
  customerSearch: document.querySelector("#customerSearch"),
  customerForm: document.querySelector("#customerForm"),
  customerId: document.querySelector("#customerId"),
  customerCode: document.querySelector("#customerCode"),
  customerFormName: document.querySelector("#customerFormName"),
  customerPhone: document.querySelector("#customerPhone"),
  newCustomer: document.querySelector("#newCustomer"),
  cancelCustomerEdit: document.querySelector("#cancelCustomerEdit"),
  customersList: document.querySelector("#customersList"),
  customersSummary: document.querySelector("#customersSummary"),
  reservationsSummary: document.querySelector("#reservationsSummary"),
  reservationStats: document.querySelector("#reservationStats"),
  reservationCustomerFilter: document.querySelector("#reservationCustomerFilter"),
  reservationSearch: document.querySelector("#reservationSearch"),
  reservationForm: document.querySelector("#reservationForm"),
  reservationCustomer: document.querySelector("#reservationCustomer"),
  reservationProduct: document.querySelector("#reservationProduct"),
  reservationProductOptions: document.querySelector("#reservationProductOptions"),
  reservationQuantity: document.querySelector("#reservationQuantity"),
  exportLowReservations: document.querySelector("#exportLowReservations"),
  exportLowCustomerReservations: document.querySelector("#exportLowCustomerReservations"),
  exportFilteredReservations: document.querySelector("#exportFilteredReservations"),
  reservationReportInput: document.querySelector("#reservationReportInput"),
  reservationImportStatus: document.querySelector("#reservationImportStatus"),
  reservationPasteInput: document.querySelector("#reservationPasteInput"),
  importPastedReservations: document.querySelector("#importPastedReservations"),
  reservationsList: document.querySelector("#reservationsList"),
  remindersSummary: document.querySelector("#remindersSummary"),
  showAllReminders: document.querySelector("#showAllReminders"),
  reminderForm: document.querySelector("#reminderForm"),
  reminderId: document.querySelector("#reminderId"),
  reminderTitle: document.querySelector("#reminderTitle"),
  reminderDueDate: document.querySelector("#reminderDueDate"),
  reminderCustomer: document.querySelector("#reminderCustomer"),
  cancelReminderEdit: document.querySelector("#cancelReminderEdit"),
  reminderStatusFilter: document.querySelector("#reminderStatusFilter"),
  reminderCustomerFilter: document.querySelector("#reminderCustomerFilter"),
  remindersList: document.querySelector("#remindersList"),
  calendarPrevious: document.querySelector("#calendarPrevious"),
  calendarNext: document.querySelector("#calendarNext"),
  calendarGregorianLabel: document.querySelector("#calendarGregorianLabel"),
  calendarHebrewLabel: document.querySelector("#calendarHebrewLabel"),
  calendarSummary: document.querySelector("#calendarSummary"),
  calendarGrid: document.querySelector("#calendarGrid"),
  calendarEventsTitle: document.querySelector("#calendarEventsTitle"),
  calendarEventsCount: document.querySelector("#calendarEventsCount"),
  calendarEventsList: document.querySelector("#calendarEventsList"),
  calendarZmanim: document.querySelector("#calendarZmanim"),
  zmanimSource: document.querySelector("#zmanimSource"),
  aiOrderForm: document.querySelector("#aiOrderForm"),
  aiOrderInput: document.querySelector("#aiOrderInput"),
  aiOrderGenerate: document.querySelector("#aiOrderGenerate"),
  aiOrderStatus: document.querySelector("#aiOrderStatus"),
  aiOrderResult: document.querySelector("#aiOrderResult"),
  dashboardStats: document.querySelector("#dashboardStats"),
  dashboardInsights: document.querySelector("#dashboardInsights"),
  dashboardTrends: document.querySelector("#dashboardTrends"),
  dashboardTrendsMeta: document.querySelector("#dashboardTrendsMeta"),
  dashboardSignals: document.querySelector("#dashboardSignals"),
  dashboardRecentOrders: document.querySelector("#dashboardRecentOrders"),
  dashboardLowReservations: document.querySelector("#dashboardLowReservations"),
  dashboardTopProducts: document.querySelector("#dashboardTopProducts"),
  dashboardOpenReminders: document.querySelector("#dashboardOpenReminders"),
  soldProductsSummary: document.querySelector("#soldProductsSummary"),
  soldProductsSearch: document.querySelector("#soldProductsSearch"),
  soldProductsStats: document.querySelector("#soldProductsStats"),
  soldProductsList: document.querySelector("#soldProductsList"),
  customerSalesSummary: document.querySelector("#customerSalesSummary"),
  customerSalesSearch: document.querySelector("#customerSalesSearch"),
  customerSalesStats: document.querySelector("#customerSalesStats"),
  customerSalesList: document.querySelector("#customerSalesList"),
  monthlySalesSummary: document.querySelector("#monthlySalesSummary"),
  monthlySalesStats: document.querySelector("#monthlySalesStats"),
  monthlySalesList: document.querySelector("#monthlySalesList"),
  collectionsSummary: document.querySelector("#collectionsSummary"),
  collectionsStats: document.querySelector("#collectionsStats"),
  collectionForm: document.querySelector("#collectionForm"),
  collectionId: document.querySelector("#collectionId"),
  collectionCustomer: document.querySelector("#collectionCustomer"),
  collectionCustomerOptions: document.querySelector("#collectionCustomerOptions"),
  collectionAmount: document.querySelector("#collectionAmount"),
  collectionDueDate: document.querySelector("#collectionDueDate"),
  collectionNote: document.querySelector("#collectionNote"),
  collectionPaymentForm: document.querySelector("#collectionPaymentForm"),
  collectionPaymentCustomer: document.querySelector("#collectionPaymentCustomer"),
  collectionPaymentAmount: document.querySelector("#collectionPaymentAmount"),
  collectionPaymentStatus: document.querySelector("#collectionPaymentStatus"),
  collectionReportInput: document.querySelector("#collectionReportInput"),
  collectionImportStatus: document.querySelector("#collectionImportStatus"),
  cancelCollectionEdit: document.querySelector("#cancelCollectionEdit"),
  collectionSearch: document.querySelector("#collectionSearch"),
  collectionStatusFilter: document.querySelector("#collectionStatusFilter"),
  collectionMonthFilter: document.querySelector("#collectionMonthFilter"),
  collectionColorFilter: document.querySelector("#collectionColorFilter"),
  collectionsList: document.querySelector("#collectionsList"),
  customerOrders: document.querySelector("#customerOrders"),
  customerHistoryTitle: document.querySelector("#customerHistoryTitle"),
  customerHistory: document.querySelector(".customer-history"),
  cartItems: document.querySelector("#cartItems"),
  cartSummary: document.querySelector("#cartSummary"),
  cartTotal: document.querySelector("#cartTotal"),
  floatingCart: document.querySelector("#floatingCart"),
  floatingCartCount: document.querySelector("#floatingCartCount"),
  floatingCartTotal: document.querySelector("#floatingCartTotal"),
  clearCart: document.querySelector("#clearCart"),
  saveAsDraft: document.querySelector("#saveAsDraft"),
  saveOrder: document.querySelector("#saveOrder"),
  sendWhatsApp: document.querySelector("#sendWhatsApp"),
  draftSearch: document.querySelector("#draftSearch"),
  draftsSummary: document.querySelector("#draftsSummary"),
  draftsList: document.querySelector("#draftsList"),
  orderSearch: document.querySelector("#orderSearch"),
  ordersList: document.querySelector("#ordersList"),
  completedOrderSearch: document.querySelector("#completedOrderSearch"),
  completedOrdersList: document.querySelector("#completedOrdersList"),
  tomorrowOrderSearch: document.querySelector("#tomorrowOrderSearch"),
  tomorrowOrdersList: document.querySelector("#tomorrowOrdersList"),
  tomorrowOrdersEyebrow: document.querySelector("#tomorrowOrdersEyebrow"),
  tomorrowOrdersTitle: document.querySelector("#tomorrowOrdersTitle"),
  tomorrowOrdersChip: document.querySelector("#tomorrowOrdersChip"),
  tomorrowOrdersSearchLabel: document.querySelector("#tomorrowOrdersSearchLabel"),
  metadata: document.querySelector("#metadata"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
};

let products = [];
let defaultProducts = [];
let activeMeta = null;
let categories = [];
let annotations = {};
let cart = [];
let orders = [];
let drafts = [];
let customers = [];
let specManifest = { items: {}, lookup: {} };
let settings = { whatsappNumber: "", customerName: "", customerId: "" };
let lastPrices = {};
let reservations = [];
let reservationSeedVersion = 0;
let reminders = [];
let collections = [];
let orderCompletionMigrationVersion = 0;
let orderOpenRestoreMigrationVersion = 0;
let openCollectionDetails = new Set();
let openReservationCustomerIds = new Set();
let pendingReservationQuantities = new Map();
let calendarMonthCursor = startOfLocalMonth(new Date());
let calendarSelectedDateKey = "";
let remindersDateFilter = "";
let zmanimState = { status: "loading", shabbat: null, holidays: [], source: "", updatedAt: "" };
let aiOrderProposal = null;
let activeTab = "search";
let orderType = "delivery";
let activeCustomerId = "";
let pendingCartProduct = null;
let pendingCartPriceSource = "list";
let pendingReservationChoiceTouched = false;
let pendingOrderImport = null;
let tomorrowOrdersReportDateFilter = "";
let pendingNoteProduct = null;
let pendingArrivalProduct = null;
let customerConfirmedForCurrentCart = false;
let dashboardVatExclusion = { today: false, tomorrow: false, sunday: false, month: false, year: false };
let customerSalesExcludeVat = false;
let monthlySalesExcludeVat = false;
let editingOrderId = "";
let editingDraftId = "";
let duplicatedOrderNeedsCustomer = false;
let orderReportTomorrow = false;
let orderReportToday = false;
let categoryProductViewMode = "all";
let cloudHydrated = CLOUD_SYNC_DISABLED;
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let cloudSaveAgain = false;
let cloudSyncState = CLOUD_SYNC_DISABLED ? "local" : "syncing";
let appStarted = false;
let israelClockTimer = null;

init();

async function init() {
  bindAuthEvents();
  const authenticated = await ensureAuthenticated();
  if (authenticated) startApp();
}

async function startApp() {
  if (appStarted) return;
  appStarted = true;
  startIsraelClock();
  bindEvents();
  defaultProducts = await loadDefaultProducts();
  specManifest = await loadSpecManifest();
  categories = readCategories();
  annotations = readJson(ANNOTATIONS_KEY) || {};
  cart = readCart();
  orders = readOrders();
  drafts = readDrafts();
  customers = readCustomers();
  settings = { ...settings, ...(readJson(SETTINGS_KEY) || {}) };
  if (!settings.customerId) {
    settings.customerId = findCustomerByName(settings.customerName)?.id || "";
  }
  lastPrices = readJson(LAST_PRICES_KEY) || {};
  activeTab = readJson(ACTIVE_TAB_KEY) || "search";
  dom.customerName.value = settings.customerName || "";
  dom.whatsappNumber.value = settings.whatsappNumber || "";
  activeCustomerId = settings.customerId || customers[0]?.id || "";
  customerConfirmedForCurrentCart = Boolean(cart.length && settings.customerName);

  const storedProducts = readJson(STORAGE_KEY);
  const storedMeta = readJson(META_KEY);

  products = Array.isArray(storedProducts) && storedProducts.length
    ? ensureGeneralProduct(normalizeProducts(storedProducts))
    : defaultProducts;
  activeMeta = storedMeta || {
    sourceName: "מחירון ברירת מחדל",
    importedAt: null,
    count: products.length,
  };

  reservations = readReservations();
  reminders = readReminders();
  collections = readCollections();
  const migratedCollectionReminders = migrateCollectionDueDatesToReminders({ sync: false });
  const removedDraftReminders = purgeDraftAutoReminders({ sync: false });
  if (migratedCollectionReminders) {
    saveCollections({ sync: false });
    saveReminders({ sync: false });
  } else if (removedDraftReminders) {
    saveReminders({ sync: false });
  }
  orderType = normalizeOrderType(readJson(ORDER_TYPE_KEY));
  orderReportTomorrow = Boolean(readJson(ORDER_REPORT_TOMORROW_KEY));
  orderReportToday = Boolean(readJson(ORDER_REPORT_TODAY_KEY));
  if (orderReportToday) orderReportTomorrow = false;
  if (orderType === "reservation" && cart.some((line) => line.fromReservation)) {
    setOrderType(orderType, { render: false });
  }
  reservationSeedVersion = Number(readJson(RESERVATION_SEED_KEY)) || 0;
  if (reservationSeedVersion < RESERVATION_SEED_VERSION) {
    reservations = mergeDefaultReservations(reservations);
    reservationSeedVersion = RESERVATION_SEED_VERSION;
    saveReservations({ sync: false });
  }
  if (completeDueOrders()) saveOrders();

  render();
  loadZmanim();
  registerServiceWorker();
  hydrateCloudState();
}

function startIsraelClock() {
  updateIsraelClock();
  if (israelClockTimer) return;
  israelClockTimer = window.setInterval(updateIsraelClock, 30_000);
}

function updateIsraelClock() {
  if (!dom.ownerStatus) return;
  dom.ownerStatus.textContent = `דקל אזמי · ${israelDateTimeFormatter.format(new Date())}`;
  if (appStarted && completeDueOrders()) {
    saveOrders();
    queueCloudSave();
    render();
  }
}

function bindAuthEvents() {
  dom.authForm.addEventListener("submit", handleLogin);
  dom.pinInput.addEventListener("input", () => {
    dom.pinInput.value = dom.pinInput.value.replace(/\D/g, "").slice(0, 4);
    dom.authError.textContent = "";
  });
}

async function ensureAuthenticated() {
  if (AUTH_DISABLED) {
    unlockApp();
    return true;
  }

  try {
    const response = await fetch(AUTH_ENDPOINT, { cache: "no-store", credentials: "same-origin" });
    const data = response.ok ? await response.json() : null;
    if (data?.authenticated) {
      unlockApp();
      return true;
    }
  } catch (error) {
    console.warn("Auth check failed", error);
  }

  lockApp();
  return false;
}

async function handleLogin(event) {
  event.preventDefault();
  const pin = dom.pinInput.value.trim();
  if (pin.length !== 4) {
    dom.authError.textContent = "יש להזין קוד בן 4 ספרות.";
    dom.pinInput.focus();
    return;
  }

  dom.loginButton.disabled = true;
  dom.authError.textContent = "";

  try {
    const response = await fetch(AUTH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ pin, remember: dom.rememberMe.checked }),
    });

    if (!response.ok) {
      dom.authError.textContent = "קוד שגוי.";
      dom.pinInput.select();
      return;
    }

    dom.pinInput.value = "";
    unlockApp();
    startApp();
  } catch (error) {
    console.warn("Login failed", error);
    dom.authError.textContent = "לא הצלחתי להתחבר. נסה שוב.";
  } finally {
    dom.loginButton.disabled = false;
  }
}

function unlockApp() {
  dom.authGate.hidden = true;
  dom.appShell.hidden = false;
}

function lockApp(message = "") {
  dom.appShell.hidden = true;
  dom.floatingCart.hidden = true;
  dom.authGate.hidden = false;
  dom.authError.textContent = message;
  window.setTimeout(() => dom.pinInput.focus(), 50);
}

function bindEvents() {
  dom.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.tab === "tomorrow-orders") {
        tomorrowOrdersReportDateFilter = "";
        dom.tomorrowOrderSearch.value = "";
        renderTomorrowOrders();
      }
      if (button.dataset.tab === "reminders") remindersDateFilter = "";
      setActiveTab(button.dataset.tab);
    });
  });
  dom.headerReminders.addEventListener("click", () => {
    dom.reminderStatusFilter.value = "open";
    remindersDateFilter = getLocalDateKey(new Date());
    renderRemindersPanel();
    setActiveTab("reminders");
    dom.status.textContent = "נפתחו רק התזכורות הפתוחות להיום.";
  });
  dom.searchInput.addEventListener("input", render);
  dom.categoryFilter.addEventListener("change", render);
  dom.addCategory.addEventListener("click", addCategoryFromInput);
  dom.categoryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addCategoryFromInput();
    }
  });
  dom.categoriesList.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-category]");
    if (editButton) {
      editCategory(editButton.dataset.editCategory);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-category]");
    if (deleteButton) {
      deleteCategory(deleteButton.dataset.deleteCategory);
      return;
    }

    const category = event.target.closest("[data-filter-category]")?.dataset.filterCategory;
    if (category === undefined) return;
    dom.categoryFilter.value = category;
    setActiveTab("search");
    render();
  });
  dom.categoryProductSearch.addEventListener("input", renderCategoryProductManager);
  dom.categoryProductsList.addEventListener("change", (event) => {
    const select = event.target.closest("[data-manage-product-category]");
    if (!select) return;
    updateAnnotation(select.dataset.manageProductCategory, { category: select.value });
    renderCategoryControls();
    renderCategoryProductManager();
  });
  dom.categoryProductsList.addEventListener("click", (event) => {
    const clearArrivalFilter = event.target.closest("[data-clear-arrival-filter]");
    if (clearArrivalFilter) {
      categoryProductViewMode = "all";
      renderCategoryProductManager();
      return;
    }

    const arrivalButton = event.target.closest("[data-edit-product-arrival]");
    if (!arrivalButton) return;
    const product = products.find((item) => item.skuKey === arrivalButton.dataset.editProductArrival);
    if (product) openArrivalDialog(product);
  });
  dom.customerSearch.addEventListener("input", renderCustomersPanel);
  dom.customerSalesSearch.addEventListener("input", renderCustomerSalesPanel);
  dom.customerForm.addEventListener("submit", saveCustomerFromForm);
  dom.cancelCustomerEdit.addEventListener("click", resetCustomerForm);
  dom.newCustomer.addEventListener("click", () => openNewCustomerForm());
  dom.orderTypeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) setOrderType(input.value);
    });
  });
  dom.cartCustomerForm.addEventListener("submit", confirmCartCustomer);
  dom.cartCustomerInput.addEventListener("input", () => {
    renderCartCustomerFeedback();
    renderDialogReservationOption();
  });
  dom.cartProductPrice.addEventListener("input", () => {
    pendingCartPriceSource = "custom";
    refreshDialogDisplayDiscountPrice();
  });
  dom.cartProductPromotion.addEventListener("change", updateDialogPromotionState);
  dom.cartProductReservation.addEventListener("change", () => {
    pendingReservationChoiceTouched = true;
    updateDialogReservationPricing();
  });
  dom.cancelCartCustomer.addEventListener("click", closeCartCustomerDialog);
  dom.cancelCartCustomerTop.addEventListener("click", closeCartCustomerDialog);
  dom.cartCustomerDialog.addEventListener("click", (event) => {
    if (event.target === dom.cartCustomerDialog) closeCartCustomerDialog();
  });
  // The file/image import entry point was intentionally removed from the cart.
  // Keep the old review dialog dormant so it cannot interrupt existing orders.
  if (dom.orderImportInput) dom.orderImportInput.addEventListener("change", handleOrderImportUpload);
  dom.confirmOrderImport.addEventListener("click", loadImportedOrderIntoCart);
  dom.cancelOrderImport.addEventListener("click", closeOrderImportDialog);
  dom.cancelOrderImportTop.addEventListener("click", closeOrderImportDialog);
  dom.orderImportDialog.addEventListener("click", (event) => {
    if (event.target === dom.orderImportDialog) closeOrderImportDialog();
  });
  dom.noteForm.addEventListener("submit", saveProductNote);
  dom.deleteNote.addEventListener("click", deleteProductNote);
  dom.cancelNote.addEventListener("click", closeNoteDialog);
  dom.cancelNoteTop.addEventListener("click", closeNoteDialog);
  dom.noteDialog.addEventListener("click", (event) => {
    if (event.target === dom.noteDialog) closeNoteDialog();
  });
  dom.arrivalForm.addEventListener("submit", saveProductArrivalDate);
  dom.deleteArrival.addEventListener("click", deleteProductArrivalDate);
  dom.cancelArrival.addEventListener("click", closeArrivalDialog);
  dom.cancelArrivalTop.addEventListener("click", closeArrivalDialog);
  dom.arrivalDialog.addEventListener("click", (event) => {
    if (event.target === dom.arrivalDialog) closeArrivalDialog();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.cartCustomerDialog.hidden) closeCartCustomerDialog();
    if (event.key === "Escape" && !dom.orderImportDialog.hidden) closeOrderImportDialog();
    if (event.key === "Escape" && !dom.noteDialog.hidden) closeNoteDialog();
    if (event.key === "Escape" && !dom.arrivalDialog.hidden) closeArrivalDialog();
  });
  dom.customersList.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-customer]");
    if (editButton) {
      editCustomer(editButton.dataset.editCustomer);
      return;
    }

    const chooseButton = event.target.closest("[data-choose-customer]");
    if (chooseButton) {
      chooseCustomerForOrder(chooseButton.dataset.chooseCustomer);
      return;
    }

    const viewOrdersButton = event.target.closest("[data-view-customer-orders]");
    if (viewOrdersButton) {
      activeCustomerId = viewOrdersButton.dataset.viewCustomerOrders;
      renderCustomersPanel();
      dom.customerHistory.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const card = event.target.closest("[data-view-customer]");
    if (event.target.closest(".customer-display-sales")) return;
    if (card) {
      activeCustomerId = card.dataset.viewCustomer;
      renderCustomersPanel();
    }
  });
  dom.reservationCustomerFilter.addEventListener("change", renderReservationsPanel);
  dom.reservationSearch.addEventListener("input", renderReservationsPanel);
  dom.exportLowReservations.addEventListener("click", exportLowReservationsReport);
  dom.exportLowCustomerReservations.addEventListener("click", exportLowCustomerReservationsReport);
  dom.exportFilteredReservations.addEventListener("click", exportFilteredReservationsReport);
  dom.reservationReportInput.addEventListener("change", handleReservationReportUpload);
  dom.importPastedReservations.addEventListener("click", handlePastedReservationReport);
  dom.reservationForm.addEventListener("submit", addReservationFromForm);
  dom.reservationsList.addEventListener("input", (event) => {
    const quantityInput = event.target.closest("[data-reservation-quantity]");
    if (!quantityInput) return;
    stageReservationQuantity(quantityInput.dataset.reservationQuantity, quantityInput.value, quantityInput);
  });
  dom.reservationsList.addEventListener(
    "toggle",
    (event) => {
      const card = event.target.closest("[data-reservation-customer]");
      if (!card) return;
      const customerId = card.dataset.reservationCustomer;
      if (!customerId) return;
      if (card.open) openReservationCustomerIds.add(customerId);
      else openReservationCustomerIds.delete(customerId);
    },
    true,
  );
  dom.reservationsList.addEventListener("change", (event) => {
    const quantityInput = event.target.closest("[data-reservation-quantity]");
    if (!quantityInput) return;
    stageReservationQuantity(quantityInput.dataset.reservationQuantity, quantityInput.value, quantityInput);
  });
  dom.reservationsList.addEventListener("click", (event) => {
    const saveButton = event.target.closest("[data-save-reservation-customer]");
    if (saveButton) {
      event.preventDefault();
      event.stopPropagation();
      saveReservationCustomerChanges(saveButton.dataset.saveReservationCustomer);
      return;
    }

    const exportButton = event.target.closest("[data-export-reservations]");
    if (exportButton) {
      event.preventDefault();
      event.stopPropagation();
      exportCustomerReservations(exportButton.dataset.exportReservations);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-reservation]");
    if (!deleteButton) return;
    deleteReservation(deleteButton.dataset.deleteReservation);
  });
  dom.reminderForm.addEventListener("submit", saveReminderFromForm);
  dom.cancelReminderEdit.addEventListener("click", resetReminderForm);
  dom.showAllReminders.addEventListener("click", () => {
    remindersDateFilter = "";
    dom.reminderStatusFilter.value = "all";
    renderRemindersPanel();
    dom.status.textContent = "מוצגות כל התזכורות.";
  });
  dom.reminderStatusFilter.addEventListener("change", () => {
    remindersDateFilter = "";
    renderRemindersPanel();
  });
  dom.reminderCustomerFilter.addEventListener("change", () => {
    remindersDateFilter = "";
    renderRemindersPanel();
  });
  dom.remindersList.addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-toggle-reminder]");
    if (!toggle) return;
    setReminderCompleted(toggle.dataset.toggleReminder, toggle.checked);
  });
  dom.remindersList.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-reminder]");
    if (editButton) {
      editReminder(editButton.dataset.editReminder);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-reminder]");
    if (deleteButton) deleteReminder(deleteButton.dataset.deleteReminder);
  });
  dom.calendarPrevious.addEventListener("click", () => shiftCalendarMonth(-1));
  dom.calendarNext.addEventListener("click", () => shiftCalendarMonth(1));
  dom.calendarGrid.addEventListener("click", (event) => {
    const day = event.target.closest("[data-calendar-date]");
    if (!day) return;
    calendarSelectedDateKey = day.dataset.calendarDate;
    renderCalendarPanel();
  });
  dom.aiOrderForm.addEventListener("submit", requestAiOrderProposal);
  dom.aiOrderResult.addEventListener("click", handleAiOrderAction);
  dom.collectionForm.addEventListener("submit", saveCollectionFromForm);
  dom.collectionPaymentForm.addEventListener("submit", saveCollectionPaymentFromForm);
  dom.cancelCollectionEdit.addEventListener("click", resetCollectionForm);
  dom.collectionReportInput.addEventListener("change", handleCollectionReportUpload);
  dom.collectionSearch.addEventListener("input", renderCollectionsPanel);
  dom.collectionStatusFilter.addEventListener("change", renderCollectionsPanel);
  dom.collectionMonthFilter.addEventListener("change", renderCollectionsPanel);
  dom.collectionColorFilter.addEventListener("change", renderCollectionsPanel);
  dom.collectionsList.addEventListener(
    "toggle",
    (event) => {
      const details = event.target.closest("[data-collection-details]");
      if (!details) return;
      const collectionId = details.dataset.collectionDetails;
      if (!collectionId) return;
      if (details.open) {
        openCollectionDetails.add(collectionId);
      } else {
        openCollectionDetails.delete(collectionId);
      }
    },
    true,
  );
  dom.collectionsList.addEventListener("click", (event) => {
    const paidToggle = event.target.closest("[data-toggle-collection-paid]");
    if (paidToggle) {
      event.preventDefault();
      event.stopPropagation();
      setCollectionPaid(paidToggle.dataset.toggleCollectionPaid, paidToggle.dataset.paidNext === "true");
      return;
    }

    const monthToggle = event.target.closest("[data-toggle-collection-month]");
    if (monthToggle) {
      event.preventDefault();
      event.stopPropagation();
      setCollectionMonthPaid(
        monthToggle.dataset.toggleCollectionMonth,
        monthToggle.dataset.monthKey,
        monthToggle.dataset.paidNext === "true",
      );
      return;
    }

    const whatsappButton = event.target.closest("[data-send-collection-whatsapp]");
    if (whatsappButton) {
      sendCollectionToWhatsApp(whatsappButton.dataset.sendCollectionWhatsapp);
      return;
    }

    const editButton = event.target.closest("[data-edit-collection]");
    if (editButton) {
      editCollection(editButton.dataset.editCollection);
      return;
    }
  });
  dom.dashboardStats.closest("[data-tab-panel]").addEventListener("click", (event) => {
    const vatToggle = event.target.closest("[data-toggle-dashboard-vat]");
    if (vatToggle) {
      const period = vatToggle.dataset.toggleDashboardVat;
      if (period === "today" || period === "tomorrow" || period === "sunday" || period === "month" || period === "year") {
        dashboardVatExclusion[period] = !dashboardVatExclusion[period];
        renderDashboard();
      }
      return;
    }
    const actionButton = event.target.closest("[data-dashboard-action]");
    if (actionButton) {
      handleDashboardAction(actionButton.dataset.dashboardAction);
      return;
    }
    const button = event.target.closest("[data-dashboard-tab]");
    if (button) setActiveTab(button.dataset.dashboardTab);
  });
  dom.customerSalesList.closest("[data-tab-panel]").addEventListener("click", (event) => {
    const vatToggle = event.target.closest("[data-toggle-customer-sales-vat]");
    if (!vatToggle) return;
    event.preventDefault();
    event.stopPropagation();
    customerSalesExcludeVat = !customerSalesExcludeVat;
    renderCustomerSalesPanel();
  });
  dom.monthlySalesList.closest("[data-tab-panel]").addEventListener("click", (event) => {
    const vatToggle = event.target.closest("[data-toggle-monthly-sales-vat]");
    if (!vatToggle) return;
    event.preventDefault();
    event.stopPropagation();
    monthlySalesExcludeVat = !monthlySalesExcludeVat;
    renderMonthlySalesPanel();
  });
  dom.results.addEventListener("click", (event) => {
    const arrivalButton = event.target.closest("[data-edit-product-arrival]");
    if (arrivalButton) {
      const product = products.find((item) => item.skuKey === arrivalButton.dataset.editProductArrival);
      if (product) openArrivalDialog(product);
      return;
    }

    const noteButton = event.target.closest("[data-edit-product-note]");
    if (noteButton) {
      const product = products.find((item) => item.skuKey === noteButton.dataset.editProductNote);
      if (product) openNoteDialog(product);
      return;
    }

    const displayPriceButton = event.target.closest("[data-use-add-display-price]");
    if (displayPriceButton) {
      const row = displayPriceButton.closest(".result-row");
      const priceInput = row?.querySelector("[data-add-price]");
      const product = products.find((item) => item.skuKey === displayPriceButton.dataset.useAddDisplayPrice);
      if (priceInput && product) {
        const basePrice = parsePrice(displayPriceButton.dataset.displayBasePrice) ?? product.price;
        priceInput.value = String(getDisplayDiscountPrice(basePrice));
        priceInput.dataset.priceSource = "display";
        displayPriceButton.setAttribute("aria-pressed", "true");
      }
      return;
    }

    const promotionButton = event.target.closest("[data-add-ten-plus-one]");
    if (promotionButton) {
      const product = products.find((item) => item.skuKey === promotionButton.dataset.addTenPlusOne);
      if (!product) return;
      if (shouldAskForCartCustomer()) {
        openCartCustomerDialog(product, { promotion: true });
        return;
      }
      const row = promotionButton.closest(".result-row");
      const priceInput = row?.querySelector("[data-add-price]");
      const unitPrice = Math.max(0, parsePrice(priceInput?.value) ?? product.price);
      const priceSource = priceInput?.dataset.priceSource === "display"
        ? "display"
        : getProductPriceSource(product, unitPrice);
      addTenPlusOneToCart(product, { unitPrice, priceSource });
      return;
    }

    const button = event.target.closest("[data-add-to-cart]");
    if (!button) return;
    const product = products.find((item) => item.skuKey === button.dataset.addToCart);
    if (!product) return;
    if (shouldAskForCartCustomer()) {
      openCartCustomerDialog(product);
      return;
    }

    const row = button.closest(".result-row");
    const quantity = parseQuantity(row?.querySelector("[data-add-quantity]")?.value);
    const fromReservation = orderType === "delivery" && Boolean(row?.querySelector("[data-add-reservation]")?.checked);
    const priceInput = row?.querySelector("[data-add-price]");
    const unitPrice = Math.max(0, parsePrice(priceInput?.value) ?? product.price);
    const priceSource = priceInput?.dataset.priceSource === "display"
      ? "display"
      : getProductPriceSource(product, unitPrice);
    addProductToCart(product, {
      quantity,
      unitPrice,
      priceSource,
      fromReservation,
    });
  });
  dom.results.addEventListener("input", (event) => {
    const priceInput = event.target.closest("[data-add-price]");
    if (priceInput) {
      delete priceInput.dataset.priceSource;
      const displayButton = priceInput.closest(".result-row")?.querySelector("[data-use-add-display-price]");
      if (displayButton) {
        setDisplayDiscountButtonPrice(displayButton, parsePrice(priceInput.value) ?? 0);
        displayButton.setAttribute("aria-pressed", "false");
      }
    }
  });
  dom.cartItems.addEventListener("click", (event) => {
    const addItemsButton = event.target.closest("[data-add-cart-items]");
    if (addItemsButton) {
      setActiveTab("search");
      dom.searchInput.focus();
      return;
    }

    const removeButton = event.target.closest("[data-remove-cart]");
    if (removeButton) {
      removeCartLine(removeButton.dataset.removeCart);
      return;
    }

    const listPriceButton = event.target.closest("[data-use-list-price]");
    if (listPriceButton) {
      const line = cart.find((item) => item.lineKey === listPriceButton.dataset.useListPrice);
      if (line) updateCartLine(line.lineKey, { unitPrice: line.listPrice, priceSource: "list" });
      return;
    }

    const displayPriceButton = event.target.closest("[data-use-display-price]");
    if (displayPriceButton) {
      const line = cart.find((item) => item.lineKey === displayPriceButton.dataset.useDisplayPrice);
      if (line) {
        updateCartLine(line.lineKey, {
          unitPrice: getDisplayDiscountPrice(line.listPrice),
          priceSource: "display",
        });
      }
      return;
    }

  });
  const handleCartFieldInput = (event) => {
    const quantityInput = event.target.closest("[data-cart-quantity]");
    if (quantityInput) {
      updateCartLine(
        quantityInput.dataset.cartQuantity,
        { quantity: parseQuantity(quantityInput.value) },
        { render: false, rekey: false },
      );
      return;
    }

    const priceInput = event.target.closest("[data-cart-price]");
    if (priceInput) {
      updateCartLine(
        priceInput.dataset.cartPrice,
        { unitPrice: parsePrice(priceInput.value) ?? 0, priceSource: "custom" },
        { render: false, rekey: false },
      );
    }
  };
  const handleCartFieldChange = (event) => {
    const quantityInput = event.target.closest("[data-cart-quantity]");
    if (quantityInput) {
      updateCartLine(quantityInput.dataset.cartQuantity, { quantity: parseQuantity(quantityInput.value) });
      return;
    }

    const priceInput = event.target.closest("[data-cart-price]");
    if (priceInput) {
      updateCartLine(priceInput.dataset.cartPrice, { unitPrice: parsePrice(priceInput.value) ?? 0, priceSource: "custom" });
      return;
    }

  };
  dom.cartItems.addEventListener("input", handleCartFieldInput);
  dom.cartItems.addEventListener("change", handleCartFieldChange);
  dom.whatsappNumber.addEventListener("input", () => {
    settings.whatsappNumber = cleanString(dom.whatsappNumber.value);
    saveSettings({ sync: true });
    renderCart();
    renderOrders();
    renderCompletedOrders();
  });
  dom.customerName.addEventListener("input", () => {
    const previousCustomerId = settings.customerId;
    const customer = findCustomerByName(dom.customerName.value);
    settings.customerId = customer?.id || "";
    settings.customerName = cleanString(dom.customerName.value);
    if (settings.customerName) duplicatedOrderNeedsCustomer = false;
    if (previousCustomerId !== settings.customerId && cart.some((line) => line.fromReservation)) {
      cart = mergeCartLines(
        [
          ...cart.filter((line) => !line.fromReservation),
          ...cart
            .filter((line) => line.fromReservation)
            .map((line) => ({
              ...line,
              fromReservation: false,
              unitPrice: line.listPrice,
              priceSource: "list",
            })),
        ],
      );
      saveCart();
    }
    customerConfirmedForCurrentCart = Boolean(settings.customerName);
    saveSettings();
    renderCart();
    renderOrders();
    renderCompletedOrders();
    renderTomorrowOrders();
    renderCustomerHint();
  });
  dom.clearCart.addEventListener("click", clearCart);
  dom.saveAsDraft.addEventListener("change", renderCart);
  dom.reportTomorrow.addEventListener("change", () => {
    orderReportTomorrow = dom.reportTomorrow.checked;
    if (orderReportTomorrow) {
      orderReportToday = false;
      dom.reportToday.checked = false;
    }
    saveOrderReportTomorrow();
    renderCartSummary();
    dom.status.textContent = orderReportTomorrow
      ? "ההזמנה תיספר בדוחות לפי תאריך הדיווח הבא."
      : "תאריך הדיווח יחושב אוטומטית לפי שעת ההקמה.";
  });
  dom.reportToday.addEventListener("change", () => {
    orderReportToday = dom.reportToday.checked;
    if (orderReportToday) {
      orderReportTomorrow = false;
      dom.reportTomorrow.checked = false;
    }
    saveOrderReportTomorrow();
    renderCartSummary();
    dom.status.textContent = orderReportToday
      ? "ההזמנה תירשם להזמנות ולדוחות של היום."
      : "תאריך הדיווח יחושב אוטומטית לפי שעת ההקמה.";
  });
  dom.floatingCart.addEventListener("click", () => setActiveTab("cart"));
  dom.saveOrder.addEventListener("click", () => (editingDraftId || dom.saveAsDraft.checked ? saveDraftOrder() : saveOrder()));
  dom.sendWhatsApp.addEventListener("click", sendCurrentOrderToWhatsApp);
  dom.draftSearch.addEventListener("input", renderDrafts);
  dom.draftsList.addEventListener("change", handleDraftFieldChange);
  dom.draftsList.addEventListener("click", handleDraftActionClick);
  dom.orderSearch.addEventListener("input", renderOrders);
  dom.completedOrderSearch.addEventListener("input", renderCompletedOrders);
  dom.tomorrowOrderSearch.addEventListener("input", renderTomorrowOrders);
  dom.soldProductsSearch.addEventListener("input", renderSoldProductsPanel);
  dom.ordersList.addEventListener("click", handleOrderActionClick);
  dom.completedOrdersList.addEventListener("click", handleOrderActionClick);
  dom.tomorrowOrdersList.addEventListener("click", handleOrderActionClick);
  dom.customerOrders.addEventListener("click", handleOrderActionClick);
  dom.clearSearch.addEventListener("click", () => {
    dom.searchInput.value = "";
    dom.searchInput.focus();
    render();
  });
  dom.fileInput.addEventListener("change", handleFileUpload);
  dom.stockFileInput.addEventListener("change", handleStockFileUpload);
  dom.resetData.addEventListener("click", resetToDefaultData);
}

async function loadDefaultProducts() {
  try {
    const response = await fetch("/products.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Default data is unavailable");
    const data = await response.json();
    return ensureGeneralProduct(normalizeProducts(data.products || data));
  } catch (error) {
    console.error(error);
    dom.status.textContent = "לא הצלחתי לטעון את מחירון ברירת המחדל.";
    return [];
  }
}

async function loadSpecManifest() {
  try {
    const response = await fetch(SPEC_MANIFEST_ENDPOINT, { cache: "no-store" });
    if (!response.ok) throw new Error("Spec manifest is unavailable");
    const data = await response.json();
    return {
      items: data.items && typeof data.items === "object" ? data.items : {},
      lookup: data.lookup && typeof data.lookup === "object" ? data.lookup : {},
    };
  } catch (error) {
    console.warn("Spec manifest failed to load", error);
    return { items: {}, lookup: {} };
  }
}

async function hydrateCloudState() {
  if (CLOUD_SYNC_DISABLED) return;

  try {
    const response = await fetch(CLOUD_STATE_ENDPOINT, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) {
      lockApp("יש להתחבר מחדש.");
      return;
    }
    if (!response.ok) throw new Error(`Cloud state failed: ${response.status}`);

    const state = await response.json();
    if (hasCloudState(state)) {
      const sharedStateResult = applySharedState(state);
      persistSharedStateLocally();
      cloudSyncState = "synced";
      cloudHydrated = true;
      render();
      if (
        !Array.isArray(state.customers) ||
        !state.customers.length ||
        sharedStateResult.seededReservations ||
        sharedStateResult.removedDraftReminders ||
        sharedStateResult.migratedCollectionReminders ||
        sharedStateResult.migratedCompletedOrders ||
        sharedStateResult.restoredCurrentDayOrders ||
        Number(state.orderCompletionMigrationVersion || 0) < ORDER_COMPLETION_MIGRATION_VERSION ||
        Number(state.orderOpenRestoreMigrationVersion || 0) < ORDER_OPEN_RESTORE_MIGRATION_VERSION
      ) {
        queueCloudSave(0);
      }
      if (cloudSaveAgain) {
        cloudSaveAgain = false;
        queueCloudSave(0);
      }
      return;
    }

    cloudHydrated = true;
    cloudSyncState = "synced";
    renderMetadata();
    queueCloudSave(0);
  } catch (error) {
    console.warn("Cloud sync is unavailable", error);
    cloudHydrated = true;
    cloudSyncState = "offline";
    renderMetadata();
  }
}

async function handleFileUpload(event) {
  const [file] = event.target.files;
  if (!file) return;

  setBusy(`מעדכן מתוך ${file.name}...`);

  try {
    const importedProducts = await parseSpreadsheet(file);
    if (!importedProducts.length) {
      throw new Error("לא נמצאו שורות תקינות בקובץ.");
    }

    products = ensureGeneralProduct(mergeExistingProductStock(importedProducts, products));
    activeMeta = {
      sourceName: file.name,
      importedAt: new Date().toISOString(),
      count: products.length,
    };

    saveProductData();
    dom.searchInput.value = "";
    render();
    queueCloudSave();
    dom.status.textContent = `עודכנו ${products.length.toLocaleString("he-IL")} פריטים.`;
  } catch (error) {
    console.error(error);
    dom.status.textContent = error.message || "לא הצלחתי לקרוא את קובץ האקסל.";
  } finally {
    event.target.value = "";
  }
}

async function handleStockFileUpload(event) {
  const [file] = event.target.files;
  if (!file) return;

  setBusy(`מעדכן מלאי מתוך ${file.name}...`);

  try {
    const stockEntries = await parseStockSpreadsheet(file);
    if (!stockEntries.length) {
      throw new Error("לא נמצאו שורות מלאי תקינות בקובץ.");
    }

    const result = applyStockEntries(stockEntries);
    saveProductData();
    saveCategories();
    saveAnnotations();
    render();
    queueCloudSave();
    dom.status.textContent = `עודכן מלאי ל-${result.matched.toLocaleString("he-IL")} פריטים. ${result.zeroCategorized.toLocaleString("he-IL")} סומנו כיצאו מהמגוון.${result.unmatched ? ` ${result.unmatched.toLocaleString("he-IL")} מק״טים לא נמצאו במחירון.` : ""}`;
  } catch (error) {
    console.error(error);
    dom.status.textContent = error.message || "לא הצלחתי לקרוא את דוח המלאי.";
  } finally {
    event.target.value = "";
  }
}

async function handleOrderImportUpload(event) {
  const [file] = event.target.files;
  if (!file) return;

  dom.orderImportStatus.textContent = `קורא את ${file.name} ובודק סכומים...`;
  try {
    pendingOrderImport = await parseOrderImportFile(file);
    renderOrderImportReview();
    dom.orderImportDialog.hidden = false;
    document.body.classList.add("dialog-open");
    dom.orderImportStatus.textContent = `נמצאו ${pendingOrderImport.lines.length.toLocaleString("he-IL")} שורות. נדרש אישור לפני טעינה לסל.`;
  } catch (error) {
    console.error("Order import failed", error);
    pendingOrderImport = null;
    dom.orderImportStatus.textContent = `לא הצלחתי לייבא את הקובץ: ${error.message || "בדוק את המבנה ונסה שוב."}`;
  } finally {
    event.target.value = "";
  }
}

async function parseOrderImportFile(file) {
  const fileName = cleanString(file.name);
  const extension = fileName.split(".").pop()?.toLocaleLowerCase("en-US") || "";
  const mimeType = cleanString(file.type).toLocaleLowerCase("en-US");
  if (extension === "pdf" || mimeType === "application/pdf") return parsePdfOrderFile(file);
  if (["xlsx", "xls"].includes(extension)) return parseSpreadsheetOrderFile(file);
  if (extension === "csv" || mimeType === "text/csv") return parseOrderImportRows(parseCsvRows(await file.text()), fileName);
  if (ORDER_IMPORT_IMAGE_EXTENSIONS.has(extension) || mimeType.startsWith("image/")) return parseImageOrderFile(file);
  throw new Error("נתמכים PDF, Excel, CSV או תמונה מהגלריה בפורמט JPG, PNG, WEBP או HEIC.");
}

async function parsePdfOrderFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const documentProxy = await getDocument({ data, disableWorker: true }).promise;
  const rows = [];

  for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber);
    const textContent = await page.getTextContent({ normalizeWhitespace: true });
    rows.push(...groupPdfTextRows(textContent.items, pageNumber));
  }

  const productRows = rows.filter((row) => getImportedSku(row.text));
  if (!productRows.length) {
    const ocrText = await extractPdfTextWithOcr(documentProxy);
    if (!ocrText) throw new Error("לא נמצאו דגמים קריאים ב־PDF. נסה צילום חד של טבלת הפריטים או PDF שאינו סרוק.");
    const proposal = parseImageOrderText(ocrText, file.name, { sourceType: "PDF סרוק" });
    proposal.warnings.unshift("ה־PDF נסרק כתמונה. בדוק את הדגמים, הכמויות והמחירים לפני טעינה לסל.");
    return proposal;
  }

  const rawLines = productRows.map((row) => {
    const sku = getImportedSku(row.text);
    const product = findImportedProduct(row.text) || getProductBySku(sku);
    const quantity = getImportedQuantity(row.text);
    const pricing = getPdfRowPricing(row);
    const rawUnitPrice =
      Number.isFinite(pricing.rawUnitPrice) && pricing.rawUnitPrice >= 0
        ? pricing.rawUnitPrice
        : Number.isFinite(pricing.rawLineTotal)
          ? roundMoney(pricing.rawLineTotal / quantity)
          : parsePrice(product?.price);
    if (!Number.isFinite(rawUnitPrice) || rawUnitPrice < 0) {
      throw new Error(`לא נמצא מחיר לשורה של ${sku}.`);
    }
    const rawLineTotal =
      Number.isFinite(pricing.rawLineTotal) && pricing.rawLineTotal >= 0
        ? pricing.rawLineTotal
        : roundMoney(rawUnitPrice * quantity);
    return {
      sku: product?.sku || sku,
      quantity,
      rawUnitPrice,
      rawLineTotal,
      description: product?.description || "",
      priceIncludesVat: false,
      usedListPrice: !Number.isFinite(pricing.rawUnitPrice) && !Number.isFinite(pricing.rawLineTotal),
    };
  });

  const customerInfo = getPdfCustomerInfo(rows, productRows[0]);
  const declaredTotal = getPdfSummaryAmount(rows, (text) => /סה[״"']?כ\s*מחיר|לתשלום/.test(text));
  const declaredSubtotal = getPdfSummaryAmount(rows, (text) => /מחיר\s*כולל\s*הנחה|סכום\s*לפני\s*מע[״"']?מ/.test(text));
  const vatAmount = getPdfSummaryAmount(rows, (text) => /מע[״"']?מ/.test(text));

  return finalizeImportedOrder({
    fileName: file.name,
    sourceType: "PDF",
    customerName: customerInfo.name,
    customerPhone: customerInfo.phone,
    rawLines,
    declaredTotal,
    declaredSubtotal,
    vatAmount,
  });
}

async function parseImageOrderFile(file) {
  if (file.size > MAX_ORDER_IMPORT_IMAGE_BYTES) {
    throw new Error("התמונה גדולה מדי. העלה צילום עד 12MB, רצוי JPG או PNG חד וברור.");
  }

  let worker = null;
  try {
    worker = await createOrderOcrWorker();
    const imageSource = await prepareOrderImageForOcr(file);
    const result = await worker.recognize(imageSource);
    const text = String(result?.data?.text || "").trim();
    if (!text) throw new Error("לא נמצא טקסט בתמונה. נסה צילום חד יותר, ללא השתקפות ובתאורה טובה.");
    return parseImageOrderText(text, file.name);
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    throw new Error("לא הצלחתי לקרוא את התמונה. נסה JPG או PNG חד וברור.");
  } finally {
    if (worker) await worker.terminate();
  }
}

async function createOrderOcrWorker() {
  let lastProgress = -1;
  const worker = await createWorker(["heb", "eng"], 1, {
    logger: ({ status, progress }) => {
      const percentage = Math.round((Number(progress) || 0) * 100);
      if (percentage === lastProgress || !status) return;
      lastProgress = percentage;
      const label = status.includes("recognizing") ? "קורא את הטקסט" : "מכין זיהוי";
      dom.orderImportStatus.textContent = `${label}${percentage ? ` · ${percentage}%` : "..."}`;
    },
  });
  await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: "6" });
  return worker;
}

async function prepareOrderImageForOcr(file) {
  if (!globalThis.createImageBitmap) return file;
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
    const sourceWidth = Math.max(1, bitmap.width);
    const sourceHeight = Math.max(1, bitmap.height);
    const upscale = sourceWidth < 1600 ? Math.min(2, 1600 / sourceWidth) : 1;
    const maxScale = Math.sqrt(MAX_ORDER_IMPORT_OCR_PIXELS / (sourceWidth * sourceHeight));
    const scale = Math.max(0.25, Math.min(upscale, maxScale));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.filter = "grayscale(1) contrast(1.3)";
    context.drawImage(bitmap, 0, 0, width, height);
    context.filter = "none";
    return canvas.toDataURL("image/png");
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}

async function extractPdfTextWithOcr(documentProxy) {
  let worker = null;
  try {
    worker = await createOrderOcrWorker();
    const pages = Math.min(documentProxy.numPages, MAX_ORDER_IMPORT_OCR_PAGES);
    const textParts = [];
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      dom.orderImportStatus.textContent = `קורא PDF סרוק · עמוד ${pageNumber} מתוך ${pages}...`;
      const page = await documentProxy.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const scale = Math.min(1, Math.sqrt(MAX_ORDER_IMPORT_OCR_PIXELS / (viewport.width * viewport.height)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width * scale));
      canvas.height = Math.max(1, Math.round(viewport.height * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) continue;
      await page.render({ canvasContext: context, viewport: page.getViewport({ scale: 2 * scale }) }).promise;
      const result = await worker.recognize(canvas.toDataURL("image/png"));
      const text = cleanString(result?.data?.text || "");
      if (text) textParts.push(text);
    }
    return textParts.join("\n");
  } finally {
    if (worker) await worker.terminate();
  }
}

function parseImageOrderText(text, fileName, options = {}) {
  const seenSkuKeys = new Set();
  const rawLines = getOcrOrderCandidates(text)
    .map((candidate) => {
      const product = findImportedProduct(candidate);
      if (!product) return null;
      const skuKey = product.skuKey;
      if (!skuKey || seenSkuKeys.has(skuKey)) return null;
      seenSkuKeys.add(skuKey);
      const quantity = getImageImportedQuantity(candidate);
      const unitPrice = Math.max(0, Number(product.price) || 0);
      return {
        sku: product.sku,
        quantity,
        rawUnitPrice: unitPrice,
        rawLineTotal: roundMoney(quantity * unitPrice),
        description: product.description,
        priceIncludesVat: true,
        usedListPrice: true,
      };
    })
    .filter(Boolean);

  if (!rawLines.length) {
    throw new Error("לא זוהו דגמים בתמונה. צלם את טבלת הפריטים מקרוב כך שהמק״טים יהיו קריאים.");
  }

  const proposal = finalizeImportedOrder({
    fileName,
    sourceType: options.sourceType || "תמונה מהגלריה",
    customerName: "",
    customerPhone: "",
    rawLines,
    declaredTotal: null,
    declaredSubtotal: null,
    vatAmount: null,
  });
  proposal.warnings.unshift(
    options.sourceType === "PDF סרוק"
      ? "ב־PDF הסרוק המחירים נטענים לפי המחירון. בדוק את הכמויות והמחירים בסל לפני שמירת ההזמנה."
      : "בתמונה המחירים נטענים לפי המחירון. בדוק את הכמויות והמחירים בסל לפני שמירת ההזמנה.",
  );
  return proposal;
}

function getOcrOrderCandidates(value) {
  const rows = String(value)
    .split(/\r?\n/)
    .map((row) => cleanString(row))
    .filter(Boolean);
  const candidates = [];
  rows.forEach((row, index) => {
    candidates.push(row);
    if (rows[index + 1]) candidates.push(`${row} ${rows[index + 1]}`);
    if (rows[index - 1]) candidates.push(`${rows[index - 1]} ${row}`);
  });
  if (!candidates.length && cleanString(value)) candidates.push(cleanString(value));
  return [...new Set(candidates)];
}

function getImageImportedQuantity(value) {
  const text = cleanString(value);
  const explicit =
    text.match(/(\d+(?:[.,]\d+)?)\s*יח[׳']/)?.[1] ||
    text.match(/(?:כמות|qty|quantity)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i)?.[1] ||
    text.match(/(?:^|\s)[x×]\s*(\d+(?:[.,]\d+)?)/i)?.[1] ||
    text.match(/(\d+(?:[.,]\d+)?)\s*[x×](?:\s|$)/i)?.[1];
  const quantity = explicit ? Number(explicit.replace(",", ".")) : 1;
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

async function parseSpreadsheetOrderFile(file) {
  const rows = await readSheet(file);
  return parseOrderImportRows(rows, file.name);
}

function parseOrderImportRows(rows, fileName = "קובץ הזמנה") {
  const normalizedRows = (rows || []).map((row) => (Array.isArray(row) ? row.map((cell) => cleanString(cell)) : []));
  const headerRowIndex = findOrderImportHeaderRow(normalizedRows);
  const columns = headerRowIndex >= 0 ? getOrderImportColumns(normalizedRows[headerRowIndex]) : null;
  const dataRows = headerRowIndex >= 0 ? normalizedRows.slice(headerRowIndex + 1) : normalizedRows;
  const rawLines = dataRows
    .map((row) => columns ? createSpreadsheetImportLine(row, columns) : createFlexibleSpreadsheetImportLine(row))
    .filter(Boolean);
  if (!rawLines.length) throw new Error("לא נמצאו דגמים או שורות הזמנה תקינות בקובץ.");

  const summary = getSpreadsheetImportSummary(normalizedRows, headerRowIndex);
  const customerInfo = getSpreadsheetCustomerInfo(normalizedRows, headerRowIndex);
  return finalizeImportedOrder({
    fileName,
    sourceType: headerRowIndex >= 0 ? "Excel" : "Excel · זיהוי גמיש",
    customerName: customerInfo.name,
    customerPhone: customerInfo.phone,
    rawLines,
    declaredTotal: summary.total,
    declaredSubtotal: summary.subtotal,
    vatAmount: summary.vat,
  });
}

function groupPdfTextRows(items, pageNumber) {
  const positioned = items
    .map((item) => ({
      text: cleanString(item.str),
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0,
    }))
    .filter((item) => item.text);
  const grouped = [];
  positioned
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .forEach((item) => {
      const existing = grouped.find((row) => Math.abs(row.y - item.y) <= 3);
      if (existing) {
        existing.cells.push(item);
        return;
      }
      grouped.push({ y: item.y, cells: [item] });
    });

  return grouped.map((row) => {
    const cells = row.cells.sort((a, b) => a.x - b.x);
    return {
      pageNumber,
      y: row.y,
      cells,
      text: cells.map((cell) => cell.text).join(" "),
    };
  });
}

function getImportedSku(value) {
  const text = cleanString(value).toLocaleUpperCase("en-US");
  if (!text) return "";

  const textModelKey = getModelKey(text);
  const matchingProduct = products.find((product) => {
    const productModelKey = getModelKey(product.sku);
    return productModelKey.length >= 4 && textModelKey.includes(productModelKey);
  });
  if (matchingProduct) return matchingProduct.sku;

  const match = text.match(/(?:FJ|IT)\s*(?:[-–—_]\s*|\s+)?[A-Z0-9]{2,14}(?:\s*[-–—_]\s*[A-Z0-9]{1,14})*/);
  if (match) {
    const compact = match[0].replace(/[^A-Z0-9]/g, "");
    const brand = compact.slice(0, 2);
    const model = compact.slice(2);
    if (brand && model) return `${brand}-${model}`;
  }

  return findImportedProductByDescription(value)?.sku || "";
}

function findImportedProduct(value) {
  const sku = getImportedSku(value);
  return getProductBySku(sku) || findImportedProductByDescription(value);
}

function findImportedProductByDescription(value) {
  const normalized = normalizeSearch(value);
  if (!normalized) return null;
  const exact = products.find((product) => {
    const description = normalizeSearch(product.description);
    return description.length >= 8 && normalized.includes(description);
  });
  if (exact) return exact;

  const stopWords = new Set([
    "מקרר", "מקפיא", "מכונת", "כביסה", "מייבש", "תנור", "מדיח", "מוצר", "מוצרים", "ליטר", "nofrost", "frost", "לבן", "לבנה", "שחור", "שחורה", "נירוסטה", "שמנת",
  ]);
  const sourceTokens = new Set(
    normalized.split(" ").filter((token) => token.length >= 3 && !stopWords.has(token)),
  );
  if (!sourceTokens.size) return null;

  const matches = products
    .map((product) => {
      const productTokens = [...new Set(normalizeSearch(product.description).split(" "))]
        .filter((token) => token.length >= 3 && !stopWords.has(token));
      const shared = productTokens.filter((token) => sourceTokens.has(token));
      const score = shared.reduce((sum, token) => sum + Math.min(token.length, 8), 0);
      return { product, shared, score };
    })
    .filter((candidate) => candidate.shared.length >= 2 && candidate.score >= 7)
    .sort((first, second) => second.score - first.score || second.shared.length - first.shared.length);
  if (!matches.length) return null;
  if (matches[1] && matches[0].score - matches[1].score < 2 && matches[0].shared.length === matches[1].shared.length) {
    return null;
  }
  return matches[0].product;
}

function getImportedQuantity(value) {
  const match = cleanString(value).match(/(\d+(?:[.,]\d+)?)\s*יח[׳']/);
  const quantity = match ? Number(match[1].replace(",", ".")) : 1;
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getPdfRowPricing(row) {
  const candidates = row.cells
    .map((cell) => ({ x: cell.x, value: parseImportAmount(cell.text) }))
    .filter((item) => Number.isFinite(item.value) && item.value >= 0 && item.value < 1000000)
    .sort((a, b) => a.x - b.x);
  const hasDiscount = /\d+(?:[.,]\d+)?\s*%/.test(row.text);
  return {
    rawLineTotal: candidates[0]?.value ?? null,
    rawUnitPrice: hasDiscount ? candidates[1]?.value ?? null : candidates[2]?.value ?? null,
  };
}

function getPdfSummaryAmount(rows, matchesLabel) {
  for (const row of rows) {
    if (!matchesLabel(normalizeOrderImportHeader(row.text))) continue;
    const candidates = row.cells
      .map((cell) => parseImportAmount(cell.text))
      .filter((value) => Number.isFinite(value) && value >= 0 && value < 100000000);
    if (candidates.length) return candidates[0];
  }
  return null;
}

function getPdfCustomerInfo(rows, firstProductRow) {
  const endIndex = Math.max(0, rows.indexOf(firstProductRow));
  const headerRows = rows.slice(0, endIndex);
  const honorIndex = headerRows.findIndex((row) => /לכבוד/.test(normalizeOrderImportHeader(row.text)));
  const searchRows = honorIndex >= 0 ? headerRows.slice(honorIndex + 1) : headerRows;
  const customerRow = searchRows.find((row) => {
    const text = cleanString(row.text);
    const normalized = normalizeOrderImportHeader(text);
    return /[א-ת]/.test(text) && !/תאריך|טלפון|פקס|כתובת|הצעתמחיר|יניר|מספר/.test(normalized);
  });
  const customerName = cleanString(customerRow?.text || "").replace(/^לכבוד\s*:?\s*/, "");
  const phoneRows = customerRow ? searchRows.slice(Math.max(0, searchRows.indexOf(customerRow)), searchRows.indexOf(customerRow) + 8) : searchRows;
  const phone = phoneRows
    .map((row) => row.text.match(/0\d{1,2}-\d{6,8}/)?.[0] || "")
    .find(Boolean) || "";
  return { name: customerName, phone };
}

function findOrderImportHeaderRow(rows) {
  return rows.findIndex((row) => {
    const text = normalizeOrderImportHeader(row.join(" "));
    const hasProduct = text.includes("מקט") || text.includes("דגם") || text.includes("sku") || text.includes("מוצר") || text.includes("תיאור") || text.includes("description");
    return hasProduct && (text.includes("כמות") || text.includes("qty") || text.includes("quantity"));
  });
}

function getOrderImportColumns(headerRow) {
  const headers = headerRow.map(normalizeOrderImportHeader);
  const indexOf = (predicate) => headers.findIndex(predicate);
  const sku = indexOf((header) => header.includes("מקט") || header === "דגם" || header.includes("sku") || header.includes("model"));
  const quantity = indexOf((header) => header.includes("כמות") || header.includes("qty") || header.includes("quantity"));
  const description = indexOf((header) => header.includes("תיאור") || header.includes("מוצר") || header.includes("description"));
  const total = indexOf((header) => header.includes("סהכ") || header.includes("total"));
  const afterDiscount = indexOf((header) => header.includes("אחריהנחה") || header.includes("לאחרהנחה") || header.includes("netto"));
  const grossPrice = indexOf((header) => header.includes("כוללמעמ") || header.includes("incvat") || header.includes("gross"));
  const unitPrice = indexOf((header) => header.includes("מחירליחידה") || header.includes("מחיריחידה") || header.includes("unitprice") || header === "מחיר");
  return { sku, quantity, description, total, afterDiscount, grossPrice, unitPrice };
}

function createSpreadsheetImportLine(row, columns) {
  const source = row.join(" ");
  const product = findImportedProduct(row[columns.sku] || row[columns.description] || source);
  const sku = product?.sku || getImportedSku(row[columns.sku] || row[columns.description] || source);
  if (!sku) return null;
  const quantity = getImportedQuantity(columns.quantity >= 0 ? row[columns.quantity] : source);
  const rawLineTotal = parseImportAmount(row[columns.total]);
  const rawUnitPrice =
    parseImportAmount(row[columns.grossPrice]) ??
    parseImportAmount(row[columns.afterDiscount]) ??
    parseImportAmount(row[columns.unitPrice]) ??
    (Number.isFinite(rawLineTotal) ? roundMoney(rawLineTotal / quantity) : null) ??
    parsePrice(product?.price);
  if (!Number.isFinite(rawUnitPrice) || rawUnitPrice < 0) return null;
  return {
    sku: product?.sku || sku,
    quantity,
    rawUnitPrice,
    rawLineTotal: Number.isFinite(rawLineTotal) ? rawLineTotal : roundMoney(rawUnitPrice * quantity),
    description: cleanString(row[columns.description] || product?.description),
    priceIncludesVat: columns.grossPrice >= 0,
    usedListPrice: !Number.isFinite(parseImportAmount(row[columns.grossPrice])) &&
      !Number.isFinite(parseImportAmount(row[columns.afterDiscount])) &&
      !Number.isFinite(parseImportAmount(row[columns.unitPrice])) &&
      !Number.isFinite(rawLineTotal),
  };
}

function createFlexibleSpreadsheetImportLine(row) {
  const source = row.join(" ");
  const product = findImportedProduct(source);
  if (!product) return null;
  const quantity = getImageImportedQuantity(source);
  const values = row.map(parseImportAmount).filter((value) => Number.isFinite(value) && value >= 0);
  const possibleTotal = values.find((value) => value > Number(product.price || 0) && value / quantity >= 1) ?? null;
  const possibleUnitPrice = possibleTotal ? roundMoney(possibleTotal / quantity) : Number(product.price) || 0;
  return {
    sku: product.sku,
    quantity,
    rawUnitPrice: possibleUnitPrice,
    rawLineTotal: possibleTotal ?? roundMoney(possibleUnitPrice * quantity),
    description: product.description,
    priceIncludesVat: false,
    usedListPrice: !possibleTotal,
  };
}

function getSpreadsheetImportSummary(rows, headerRowIndex) {
  const summary = { total: null, subtotal: null, vat: null };
  rows.slice(headerRowIndex + 1).forEach((row) => {
    const label = normalizeOrderImportHeader(row.join(" "));
    const amount = row.map(parseImportAmount).find((value) => Number.isFinite(value) && value >= 0 && value < 100000000);
    if (!Number.isFinite(amount)) return;
    if (/סהכמחיר|לתשלום|grandtotal/.test(label)) summary.total = amount;
    else if (/מחירכוללהנחה|סכוםלפנימעמ|subtotal/.test(label)) summary.subtotal = amount;
    else if (/מעמ|vat/.test(label)) summary.vat = amount;
  });
  return summary;
}

function getSpreadsheetCustomerInfo(rows, headerRowIndex) {
  const topRows = rows.slice(0, headerRowIndex >= 0 ? headerRowIndex : Math.min(rows.length, 12));
  for (const row of topRows) {
    const cells = row.map(cleanString);
    const labelIndex = cells.findIndex((cell) => /לקוח|לכבוד|customer/.test(normalizeOrderImportHeader(cell)));
    if (labelIndex < 0) continue;
    const name = cells.slice(labelIndex + 1).find((cell) => /[א-תA-Za-z]/.test(cell)) || "";
    const phone = cells.map((cell) => cell.match(/0\d{1,2}-\d{6,8}/)?.[0] || "").find(Boolean) || "";
    if (name) return { name, phone };
  }
  return { name: "", phone: "" };
}

function parseCsvRows(value) {
  return String(value ?? "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(line.includes("\t") ? "\t" : ",").map((cell) => cell.trim()));
}

function parseImportAmount(value) {
  const parsed = parsePrice(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOrderImportHeader(value) {
  return normalizeSearch(value).replace(/[\s_\-/]/g, "");
}

function finalizeImportedOrder(input) {
  const rawSubtotal = roundMoney(input.rawLines.reduce((sum, line) => sum + (Number(line.rawLineTotal) || 0), 0));
  const declaredTotal = Number.isFinite(input.declaredTotal) ? roundMoney(input.declaredTotal) : null;
  const declaredSubtotal = Number.isFinite(input.declaredSubtotal) ? roundMoney(input.declaredSubtotal) : null;
  const vatAmount = Number.isFinite(input.vatAmount) ? roundMoney(input.vatAmount) : null;
  const inferredNetPrices = input.rawLines.some((line) => line.priceIncludesVat === false) &&
    Boolean(declaredTotal && isAmountClose(roundMoney(rawSubtotal * (1 + VAT_RATE)), declaredTotal));
  const multiplier = inferredNetPrices ? 1 + VAT_RATE : 1;
  const lines = input.rawLines.map((line) => {
    const product = products.find((item) => item.skuKey === getSkuKey(line.sku));
    const quantity = getImportedQuantity(String(line.quantity));
    const unitPrice = roundMoney((Number(line.rawUnitPrice) || 0) * multiplier);
    return {
      ...line,
      product,
      quantity,
      unitPrice,
      lineTotal: roundMoney(quantity * unitPrice),
    };
  });

  let calculatedTotal = getOrderTotal(lines);
  const roundingDifference = declaredTotal ? roundMoney(declaredTotal - calculatedTotal) : 0;
  if (lines.length && Math.abs(roundingDifference) <= 0.1 && roundingDifference !== 0) {
    const lastLine = lines[lines.length - 1];
    lastLine.unitPrice = roundMoney(lastLine.unitPrice + roundingDifference / lastLine.quantity);
    lastLine.lineTotal = roundMoney(lastLine.unitPrice * lastLine.quantity);
    calculatedTotal = getOrderTotal(lines);
  }

  const unresolved = lines.filter((line) => !line.product);
  const listPricedLines = lines.filter((line) => line.usedListPrice).length;
  const matchesTotal = !declaredTotal || isAmountClose(calculatedTotal, declaredTotal);
  const warnings = [];
  if (!input.customerName) warnings.push("לא זוהה שם לקוח. אפשר להזין אותו ידנית לפני טעינה לסל.");
  if (unresolved.length) warnings.push(`${unresolved.length.toLocaleString("he-IL")} דגמים לא נמצאו במחירון ולכן לא ייטענו לסל.`);
  if (listPricedLines) warnings.push(`${listPricedLines.toLocaleString("he-IL")} שורות קיבלו מחיר מהמחירון כי לא זוהה מחיר בקובץ.`);
  if (declaredTotal && !matchesTotal) warnings.push("הסכום המחושב אינו תואם לסכום הסופי בקובץ.");
  if (!declaredTotal) warnings.push("לא זוהה סכום סופי בקובץ; בדוק את הסכום לפני טעינה לסל.");

  return {
    ...input,
    declaredTotal,
    declaredSubtotal,
    vatAmount,
    rawSubtotal,
    inferredNetPrices,
    lines,
    calculatedTotal,
    matchesTotal,
    unresolved,
    listPricedLines,
    warnings,
  };
}

function isAmountClose(first, second) {
  return Math.abs((Number(first) || 0) - (Number(second) || 0)) <= 0.1;
}

function renderOrderImportReview() {
  const proposal = pendingOrderImport;
  if (!proposal) return;
  const existingCustomer = findCustomerByName(proposal.customerName);
  dom.orderImportCustomerName.value = proposal.customerName || "";
  dom.orderImportCustomerPhone.value = proposal.customerPhone || existingCustomer?.phone || "";
  const difference = proposal.declaredTotal ? roundMoney(proposal.calculatedTotal - proposal.declaredTotal) : null;
  const totalTone = proposal.matchesTotal ? "matched" : "mismatch";
  const customerStatus = existingCustomer ? "לקוח קיים ייבחר אוטומטית" : "לקוח חדש ייווצר כשתאשר טעינה לסל";
  const priceMode = proposal.inferredNetPrices ? "מחירי הקובץ הומרו ממחיר לפני מע״מ למחיר כולל מע״מ." : "המחירים נטענים כפי שהופיעו בקובץ.";

  dom.orderImportReview.innerHTML = `
    <div class="order-import-source"><span>${escapeHtml(proposal.sourceType)}</span><strong>${escapeHtml(proposal.fileName)}</strong></div>
    <div class="order-import-summary-grid">
      <div><span>סטטוס לקוח</span><strong>${escapeHtml(customerStatus)}</strong></div>
      <div><span>שורות שזוהו</span><strong>${proposal.lines.length.toLocaleString("he-IL")}</strong></div>
      <div><span>סה״כ בקובץ</span><strong>${proposal.declaredTotal ? escapeHtml(formatPrice(proposal.declaredTotal)) : "לא זוהה"}</strong></div>
      <div class="${totalTone}"><span>סה״כ שייטען לסל</span><strong>${escapeHtml(formatPrice(proposal.calculatedTotal))}</strong><small>${difference === null ? "בדיקה ידנית" : proposal.matchesTotal ? "תואם לקובץ" : `הפרש ${escapeHtml(formatPrice(Math.abs(difference)))}`}</small></div>
    </div>
    <p class="order-import-tax-note">${escapeHtml(priceMode)}${proposal.declaredSubtotal ? ` לפני מע״מ: ${formatPrice(proposal.declaredSubtotal)}${proposal.vatAmount ? ` · מע״מ: ${formatPrice(proposal.vatAmount)}` : ""}` : ""}</p>
    <div class="order-import-lines">
      ${proposal.lines.map((line) => `
        <article class="order-import-line${line.product ? "" : " unresolved"}">
          <div><strong>${escapeHtml(line.sku)}</strong><span>${escapeHtml(line.product?.description || line.description || "לא נמצא במחירון")}</span></div>
          <span>${line.quantity.toLocaleString("he-IL")} יח׳</span>
          <b>${escapeHtml(formatPrice(line.lineTotal))}</b>
        </article>
      `).join("")}
    </div>
    ${proposal.warnings.length ? `<ul class="order-import-warnings">${proposal.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : ""}
  `;
  dom.confirmOrderImport.disabled = Boolean(proposal.unresolved.length) || !proposal.matchesTotal;
}

function closeOrderImportDialog() {
  pendingOrderImport = null;
  dom.orderImportDialog.hidden = true;
  document.body.classList.remove("dialog-open");
}

function loadImportedOrderIntoCart() {
  const proposal = pendingOrderImport;
  if (!proposal) return;
  const customerName = cleanString(dom.orderImportCustomerName.value);
  const customerPhone = cleanString(dom.orderImportCustomerPhone.value);
  if (!customerName) {
    dom.orderImportStatus.textContent = "צריך להזין שם לקוח לפני טעינה לסל.";
    dom.orderImportCustomerName.focus();
    return;
  }
  if (proposal.unresolved.length || !proposal.matchesTotal) {
    dom.orderImportStatus.textContent = "יש פערים בייבוא. תקן אותם לפני טעינה לסל.";
    return;
  }

  let customer = findCustomerByName(customerName);
  if (!customer) {
    customer = {
      id: createCustomerId(customerName),
      code: "",
      name: customerName,
      phone: customerPhone,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    customers = [...customers, customer].sort((a, b) => a.name.localeCompare(b.name, "he"));
  } else if (customerPhone && customer.phone !== customerPhone) {
    customer = { ...customer, phone: customerPhone, updatedAt: new Date().toISOString() };
    customers = customers.map((item) => (item.id === customer.id ? customer : item));
  }

  applyCustomerToDraft(customer);
  const importedLines = proposal.lines.map((line) => ({
    lineKey: createCartLineKey(line.product.skuKey, false, line.unitPrice, "custom"),
    skuKey: line.product.skuKey,
    sku: line.product.sku,
    description: line.product.description,
    listPrice: line.product.price,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    fromReservation: false,
    priceSource: "custom",
  }));
  cart = mergeCartLines([...cart, ...importedLines]);
  customerConfirmedForCurrentCart = true;
  saveCart();
  saveSettings();
  saveCustomers();
  closeOrderImportDialog();
  render();
  setActiveTab("cart");
  dom.orderImportStatus.textContent = `הקובץ נטען לסל עבור ${customer.name}. בדוק את השורות ולחץ „שמור הזמנה” רק כשאתה מאשר.`;
  dom.status.textContent = "הייבוא הוכן בסל לבדיקה. ההזמנה טרם נשמרה ולא נכנסה לדוחות.";
}

async function parseSpreadsheet(file) {
  const rows = await readSheet(file);
  if (!rows.length) throw new Error("לא נמצאו שורות בקובץ.");

  const { columns, headerRowIndex } = detectColumns(rows);
  const dataRows = rows.slice(headerRowIndex + 1);
  return normalizeProducts(
    dataRows.map((row) => ({
      sku: row[columns.sku],
      description: row[columns.description],
      price: row[columns.price],
    })),
  );
}

function detectColumns(rows) {
  const fallback = { sku: 0, description: 1, price: 2 };
  let best = { score: -1, columns: fallback, headerRowIndex: -1 };

  rows.slice(0, 20).forEach((row, rowIndex) => {
    const columns = {};
    row.forEach((cell, columnIndex) => {
      const label = normalizeHeader(cell);
      if (!label) return;

      if (columns.sku === undefined && hasAny(label, ["מקט", "sku", "item", "part", "דגם", "model"])) {
        columns.sku = columnIndex;
      }
      if (
        columns.description === undefined &&
        hasAny(label, ["תאור", "תיאור", "מוצר", "description", "desc", "name"])
      ) {
        columns.description = columnIndex;
      }
      if (columns.price === undefined && hasAny(label, ["מחיר", "price", "כולל מעמ", "vat"])) {
        columns.price = columnIndex;
      }
    });

    const score = Number(columns.sku !== undefined) + Number(columns.description !== undefined) + Number(columns.price !== undefined);
    if (score > best.score) {
      best = {
        score,
        columns: { ...fallback, ...columns },
        headerRowIndex: score >= 2 ? rowIndex : -1,
      };
    }
  });

  return best;
}

async function parseStockSpreadsheet(file) {
  const rows = await readSheet(file);
  if (!rows.length) throw new Error("לא נמצאו שורות בקובץ.");

  const { columns, headerRowIndex } = detectStockColumns(rows);
  const dataRows = rows.slice(headerRowIndex + 1);
  const grouped = new Map();

  dataRows.forEach((row) => {
    const sku = cleanString(row[columns.sku]);
    const skuKey = getSkuKey(sku);
    const quantity = parseStockQuantity(row[columns.stockQuantity]);
    if (!skuKey || quantity === null) return;

    const current = grouped.get(skuKey) || {
      sku,
      skuKey,
      description: cleanString(row[columns.description]),
      stockQuantity: 0,
    };
    current.stockQuantity += quantity;
    if (!current.description && columns.description !== undefined) current.description = cleanString(row[columns.description]);
    grouped.set(skuKey, current);
  });

  return [...grouped.values()];
}

function detectStockColumns(rows) {
  let best = { score: -1, columns: {}, headerRowIndex: -1 };

  rows.slice(0, 30).forEach((row, rowIndex) => {
    const columns = {};
    row.forEach((cell, columnIndex) => {
      const label = normalizeHeader(cell);
      if (!label) return;

      if (columns.sku === undefined && hasAny(label, ["מקט", "sku", "item", "part", "מספר פריט", "דגם", "model"])) {
        columns.sku = columnIndex;
      }
      if (
        columns.description === undefined &&
        hasAny(label, ["תאור", "תיאור", "מוצר", "description", "desc", "name"])
      ) {
        columns.description = columnIndex;
      }
      if (
        columns.stockQuantity === undefined &&
        hasAny(label, ["יתרה", "מחסן", "מלאי", "כמות", "balance", "stock", "inventory", "qty"])
      ) {
        columns.stockQuantity = columnIndex;
      }
    });

    const score =
      Number(columns.sku !== undefined) +
      Number(columns.stockQuantity !== undefined) +
      Number(columns.description !== undefined) * 0.25;
    if (score > best.score) {
      best = {
        score,
        columns,
        headerRowIndex: columns.sku !== undefined && columns.stockQuantity !== undefined ? rowIndex : -1,
      };
    }
  });

  if (best.headerRowIndex < 0) {
    throw new Error("לא מצאתי בדוח עמודת מק״ט ועמודת יתרה במחסן.");
  }

  return best;
}

function normalizeProducts(items) {
  const seen = new Set();

  return items
    .map((item, index) => {
      const sku = cleanString(item.sku);
      const description = cleanString(item.description);
      const price = parsePrice(item.price);
      const stockQuantity = parseStockQuantity(item.stockQuantity ?? item.stock ?? item.inventory ?? item.quantityOnHand);
      const key = `${sku}|${description}|${price ?? ""}`;

      if ((!sku && !description) || price === null || seen.has(key)) return null;
      seen.add(key);

      const product = {
        id: `${sku || "row"}-${index}`,
        sku,
        skuKey: getSkuKey(sku),
        description,
        price,
        priceText: formatPrice(price),
        searchText: normalizeSearch(`${sku} ${description}`),
      };
      if (stockQuantity !== null) product.stockQuantity = stockQuantity;
      return product;
    })
    .filter(Boolean);
}

function mergeExistingProductStock(nextProducts, currentProducts) {
  const stockBySku = new Map(
    currentProducts
      .filter((product) => hasStockQuantity(product))
      .map((product) => [product.skuKey, product.stockQuantity]),
  );

  return nextProducts.map((product) => {
    if (hasStockQuantity(product) || !stockBySku.has(product.skuKey)) return product;
    return { ...product, stockQuantity: stockBySku.get(product.skuKey) };
  });
}

function applyStockEntries(stockEntries) {
  const stockBySku = new Map(stockEntries.map((entry) => [entry.skuKey, parseStockQuantity(entry.stockQuantity)]));
  const productSkuKeys = new Set(products.map((product) => product.skuKey));
  let discontinuedCategory = "";
  let matched = 0;
  let zeroCategorized = 0;
  let restoredFromDiscontinued = 0;

  products = products.map((product) => {
    if (!stockBySku.has(product.skuKey)) {
      const { stockQuantity, ...withoutStock } = product;
      return withoutStock;
    }

    const stockQuantity = stockBySku.get(product.skuKey) ?? 0;
    matched += 1;
    const annotation = annotations[product.skuKey] || { category: "", note: "", arrivalDate: "" };
    if (stockQuantity === 0) {
      discontinuedCategory ||= getDiscontinuedCategoryName();
      if (annotation.category !== discontinuedCategory) {
        annotations[product.skuKey] = { ...annotation, category: discontinuedCategory };
      }
      zeroCategorized += 1;
    } else if (isDiscontinuedCategory(annotation.category)) {
      const nextAnnotation = { ...annotation, category: "" };
      if (nextAnnotation.note || nextAnnotation.arrivalDate) {
        annotations[product.skuKey] = nextAnnotation;
      } else {
        delete annotations[product.skuKey];
      }
      restoredFromDiscontinued += 1;
    }

    return { ...product, stockQuantity };
  });

  return {
    matched,
    zeroCategorized,
    restoredFromDiscontinued,
    unmatched: stockEntries.filter((entry) => !productSkuKeys.has(entry.skuKey)).length,
  };
}

function ensureGeneralProduct(items) {
  const generalSkuKey = getSkuKey(GENERAL_PRODUCT.sku);
  if (items.some((product) => product.skuKey === generalSkuKey)) return items;
  const [generalProduct] = normalizeProducts([GENERAL_PRODUCT]);
  return generalProduct ? [...items, generalProduct] : items;
}

function render() {
  renderTabs();
  renderMetadata();
  renderCategoryControls();
  renderCategoryProductManager();
  renderCustomerOptions();
  renderCustomerHint();
  renderCustomersPanel();
  renderReservationsPanel();
  renderRemindersPanel();
  renderCollectionsPanel();
  renderDashboard();
  renderSoldProductsPanel();
  renderCustomerSalesPanel();
  renderMonthlySalesPanel();
  renderCart();
  renderDrafts();
  renderOrders();
  renderCompletedOrders();
  renderTomorrowOrders();

  const query = normalizeSearch(dom.searchInput.value);
  const activeCategory = dom.categoryFilter.value;
  let matches = query ? searchProducts(query) : products;

  if (activeCategory) {
    matches = matches.filter((product) => getAnnotation(product).category === activeCategory);
  }

  const visibleCount = query || activeCategory ? MAX_RESULTS : INITIAL_RESULTS;
  const visibleMatches = matches.slice(0, visibleCount);

  dom.clearSearch.hidden = !dom.searchInput.value;
  dom.status.textContent = buildStatus(query, activeCategory, matches.length);
  dom.results.replaceChildren(...renderResultNodes(visibleMatches, query, matches.length));
}

function renderMetadata() {
  const count = products.length.toLocaleString("he-IL");
  const date = activeMeta?.importedAt ? new Date(activeMeta.importedAt).toLocaleDateString("he-IL") : "נתוני פתיחה";
  const syncLabel = getSyncLabel();
  dom.metadata.textContent = `${count} פריטים · ${date}${syncLabel ? ` · ${syncLabel}` : ""}`;
}

function getSyncLabel() {
  if (CLOUD_SYNC_DISABLED) return "בדיקה מקומית";
  if (cloudSyncState === "syncing") return "מסנכרן";
  if (cloudSyncState === "saving") return "שומר בענן";
  if (cloudSyncState === "synced") return "נשמר בענן";
  if (cloudSyncState === "offline") return "שמירה מקומית";
  return "";
}

function renderTabs() {
  dom.tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === activeTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  dom.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === activeTab);
  });
}

function setActiveTab(tab) {
  if (!dom.tabPanels.some((panel) => panel.dataset.tabPanel === tab)) return;
  activeTab = tab;
  localStorage.setItem(ACTIVE_TAB_KEY, JSON.stringify(activeTab));
  renderTabs();
  renderFloatingCart();
}

function handleDashboardAction(action) {
  if (action === "today-orders") {
    const todayKey = getLocalDateKey(new Date());
    const todayOpenOrders = orders.filter(
      (order) => !isOrderCompleted(order) && getOrderReportDateKey(order) === todayKey,
    );
    if (!todayOpenOrders.length) {
      dom.status.textContent = "אין כרגע הזמנות פתוחות להיום.";
      return;
    }
    dom.orderSearch.value = "";
    renderOrders();
    setActiveTab("orders");
    window.setTimeout(() => dom.orderSearch.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    dom.status.textContent = `נפתחו ${todayOpenOrders.length.toLocaleString("he-IL")} הזמנות פתוחות להיום.`;
    return;
  }

  if (action === "tomorrow-orders") {
    tomorrowOrdersReportDateFilter = "";
    dom.tomorrowOrderSearch.value = "";
    renderTomorrowOrders();
    setActiveTab("tomorrow-orders");
    window.setTimeout(() => dom.tomorrowOrderSearch.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    dom.status.textContent = "נפתחה לשונית הזמנות למחר.";
    return;
  }

  if (action === "sunday-orders") {
    const sundayKey = getUpcomingSundayLocalDateKey(new Date());
    const sundayOrders = orders.filter((order) => !isOrderCompleted(order) && getOrderReportDateKey(order) === sundayKey);
    if (!sundayOrders.length) {
      dom.status.textContent = "אין כרגע הזמנות פתוחות ליום ראשון.";
      return;
    }
    tomorrowOrdersReportDateFilter = sundayKey;
    dom.tomorrowOrderSearch.value = "";
    renderTomorrowOrders();
    setActiveTab("tomorrow-orders");
    window.setTimeout(() => dom.tomorrowOrderSearch.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    dom.status.textContent = `נפתחו ${sundayOrders.length.toLocaleString("he-IL")} הזמנות פתוחות ליום ראשון.`;
    return;
  }

  if (action === "stock-arrivals") {
    categoryProductViewMode = "arrivals";
    dom.categoryProductSearch.value = "";
    renderCategoryProductManager();
    setActiveTab("categories");
    window.setTimeout(() => dom.categoryProductSearch.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    dom.status.textContent = "מוצגים מוצרים עם תאריך חזרה למלאי פעיל.";
  }
}

function renderCategoryControls() {
  const currentValue = dom.categoryFilter.value;
  const categoryCounts = getCategoryCounts();

  dom.categoryFilter.replaceChildren(createOption("", "כל הקטגוריות", currentValue === ""));
  categories.forEach((category) => {
    const count = categoryCounts.get(category) || 0;
    const label = count ? `${category} · ${count}` : category;
    dom.categoryFilter.append(createOption(category, label, currentValue === category));
  });

  if (currentValue && !categories.includes(currentValue)) {
    dom.categoryFilter.value = "";
  }

  if (!categories.length) {
    const empty = document.createElement("span");
    empty.className = "category-empty";
    empty.textContent = "אין קטגוריות עדיין";
    dom.categoriesList.replaceChildren(empty);
    return;
  }

  const rows = categories.map((category) => {
    const row = document.createElement("div");
    row.className = "category-admin-row";

    const filter = document.createElement("button");
    filter.type = "button";
    filter.className = "category-chip";
    filter.dataset.filterCategory = category;
    filter.setAttribute("aria-pressed", String(dom.categoryFilter.value === category));
    filter.textContent = `${category}${categoryCounts.get(category) ? ` · ${categoryCounts.get(category)}` : ""}`;

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-text-button";
    edit.dataset.editCategory = category;
    edit.textContent = "ערוך";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger-button compact-danger";
    remove.dataset.deleteCategory = category;
    remove.textContent = "מחק";

    row.append(filter, edit, remove);
    return row;
  });
  dom.categoriesList.replaceChildren(...rows);
}

function renderCategoryProductManager() {
  const query = normalizeSearch(dom.categoryProductSearch.value);
  const arrivalOnly = categoryProductViewMode === "arrivals";
  const referenceDate = new Date();
  const visibleProducts = products
    .filter((product) => {
      const annotation = getAnnotation(product);
      const activeArrival = isActiveArrivalDate(annotation.arrivalDate, referenceDate);
      if (arrivalOnly && !activeArrival) return false;
      if (!query) return true;
      const searchable = normalizeSearch(
        `${product.searchText} ${annotation.category} ${annotation.note} ${formatArrivalDate(annotation.arrivalDate)} ${formatStockQuantity(product)}`,
      );
      return searchable.includes(query);
    })
    .slice(0, 80);

  const nodes = [];
  if (arrivalOnly) {
    const banner = document.createElement("div");
    banner.className = "category-filter-banner";
    banner.innerHTML = `
      <span>מוצגים רק מוצרים עם תאריך חזרה למלאי פעיל</span>
      <button type="button" class="secondary-button" data-clear-arrival-filter>הצג את כל המוצרים</button>
    `;
    nodes.push(banner);
  }

  if (!visibleProducts.length) {
    const message = arrivalOnly ? "אין מוצרים עם תאריך חזרה למלאי פעיל." : "לא נמצאו מוצרים.";
    dom.categoryProductsList.replaceChildren(...nodes, emptyState(message));
    return;
  }

  const rows = visibleProducts.map((product) => {
    const annotation = getAnnotation(product);
    const activeArrival = isActiveArrivalDate(annotation.arrivalDate, referenceDate);
    const row = document.createElement("article");
    row.className = "category-product-row";

    const details = document.createElement("div");
    details.className = "category-product-details";
    const sku = document.createElement("strong");
    sku.textContent = product.sku || "ללא מק״ט";
    const description = document.createElement("span");
    description.textContent = product.description || "ללא תיאור";
    details.append(sku, description);
    if (hasStockQuantity(product)) {
      const stock = document.createElement("small");
      stock.className = `stock-label stock-${getStockTone(product)}`;
      stock.textContent = `במחסן: ${formatStockQuantity(product)}`;
      details.append(stock);
    }
    if (activeArrival) {
      const arrival = document.createElement("small");
      arrival.className = "category-product-arrival";
      arrival.textContent = `חזרה למלאי: ${formatArrivalDate(annotation.arrivalDate)}`;
      details.append(arrival);
    }

    const select = document.createElement("select");
    select.dataset.manageProductCategory = product.skuKey;
    select.setAttribute("aria-label", `קטגוריה עבור ${product.sku || product.description}`);
    select.append(createOption("", "ללא קטגוריה", !annotation.category));
    categories.forEach((category) => {
      select.append(createOption(category, category, annotation.category === category));
    });

    const controls = document.createElement("div");
    controls.className = "category-product-controls";

    const arrivalButton = document.createElement("button");
    arrivalButton.className = "icon-text-button category-arrival-button";
    arrivalButton.type = "button";
    arrivalButton.dataset.editProductArrival = product.skuKey;
    arrivalButton.textContent = annotation.arrivalDate ? "ערוך הגעה" : "תאריך הגעה";

    controls.append(select, arrivalButton);
    row.append(details, controls);
    return row;
  });
  dom.categoryProductsList.replaceChildren(...nodes, ...rows);
}

function searchProducts(query) {
  const terms = query.split(" ").filter(Boolean);

  return products
    .map((product) => {
      const annotation = getAnnotation(product);
      const sku = normalizeSearch(product.sku);
      const haystack = normalizeSearch(`${product.searchText} ${annotation.category} ${annotation.note}`);
      const allTermsMatch = terms.every((term) => haystack.includes(term));
      if (!allTermsMatch) return null;

      let score = 0;
      if (sku === query) score += 100;
      if (sku.startsWith(query)) score += 70;
      if (sku.includes(query)) score += 45;
      if (haystack.startsWith(query)) score += 20;
      score += Math.max(0, 20 - haystack.indexOf(terms[0]));

      return { product, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.product.sku.localeCompare(b.product.sku, "he"))
    .map(({ product }) => product);
}

function renderResultNodes(items, query, totalMatches) {
  if (!products.length) {
    return [emptyState("אין מחירון טעון.")];
  }

  if ((query || dom.categoryFilter.value) && !totalMatches) {
    return [emptyState("לא נמצאו התאמות.")];
  }

  if (!query && !items.length) {
    return [emptyState("הקלד מק״ט או דגם.")];
  }

  return items.map((product) => {
    const annotation = getAnnotation(product);
    const isDiscontinued = isDiscontinuedCategory(annotation.category);
    const article = document.createElement("article");
    article.className = "result-row";
    article.classList.toggle("discontinued-product", isDiscontinued);

    const main = document.createElement("div");
    main.className = "result-main";

    const content = document.createElement("div");
    content.className = "result-content";

    const sku = document.createElement("div");
    sku.className = "sku";
    sku.textContent = product.sku || "ללא מק״ט";

    const description = document.createElement("div");
    description.className = "description";
    description.textContent = product.description || "ללא תיאור";

    const annotationMeta = document.createElement("div");
    annotationMeta.className = "annotation-meta";
    if (annotation.category) {
      const category = document.createElement("span");
      category.className = "category-label";
      category.textContent = annotation.category;
      annotationMeta.append(category);
    }
    if (hasStockQuantity(product)) {
      const stock = document.createElement("span");
      stock.className = `stock-label stock-${getStockTone(product)}`;
      stock.textContent = `במחסן: ${formatStockQuantity(product)}`;
      annotationMeta.append(stock);
    }
    if (annotation.note) {
      const note = document.createElement("p");
      note.className = "product-note-display";
      note.textContent = annotation.note;
      annotationMeta.append(note);
    }
    if (isActiveArrivalDate(annotation.arrivalDate)) {
      const arrival = document.createElement("span");
      arrival.className = "arrival-date-label";
      arrival.textContent = `צפוי במלאי: ${formatArrivalDate(annotation.arrivalDate)}`;
      annotationMeta.append(arrival);
    }
    if (isDiscontinued) {
      const availability = document.createElement("span");
      availability.className = "unavailable-label";
      availability.textContent = "יצא מהמגוון · לא ניתן להזמנה";
      annotationMeta.append(availability);
    }

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = product.priceText;

    const actions = document.createElement("div");
    actions.className = "result-actions";
    if (!isDiscontinued) {
      const addButton = document.createElement("button");
      addButton.className = "add-cart-button";
      addButton.type = "button";
      addButton.dataset.addToCart = product.skuKey;
      addButton.textContent = "הוסף לסל";
      actions.append(addButton);

      const promotionButton = document.createElement("button");
      promotionButton.className = "ten-plus-one-button";
      promotionButton.type = "button";
      promotionButton.dataset.addTenPlusOne = product.skuKey;
      promotionButton.setAttribute("aria-label", `הוסף מבצע 10 ועוד 1 עבור ${product.sku || product.description}`);
      promotionButton.innerHTML = `${getOrderActionIcon("bonus")}<span>10+1</span>`;
      actions.append(promotionButton);
    }

    getProductDocuments(product).forEach((productDocument) => {
      const specLink = document.createElement("a");
      specLink.className = `spec-button${productDocument.installation ? " installation-button" : ""}`;
      specLink.href = productDocument.url;
      specLink.target = "_blank";
      specLink.rel = "noreferrer";
      if (productDocument.installation) {
        specLink.dataset.productInstallation = product.skuKey;
      } else {
        specLink.dataset.productSpec = product.skuKey;
      }
      specLink.title = productDocument.installation ? "פתח הוראות התקנה" : "פתח דף מוצר";
      specLink.setAttribute(
        "aria-label",
        `${productDocument.installation ? "פתח הוראות התקנה" : "פתח דף מוצר"} עבור ${product.sku || product.description}`,
      );

      const specIcon = document.createElement("span");
      specIcon.className = "spec-button-icon";
      specIcon.setAttribute("aria-hidden", "true");

      const specText = document.createElement("span");
      specText.textContent = productDocument.installation ? "התקנה" : "דף מוצר";

      specLink.append(specIcon, specText);
      actions.append(specLink);
    });

    const noteButton = document.createElement("button");
    noteButton.className = "icon-text-button note-button";
    noteButton.type = "button";
    noteButton.dataset.editProductNote = product.skuKey;
    noteButton.textContent = annotation.note ? "ערוך הערה" : "הוסף הערה";
    actions.append(noteButton);

    const arrivalButton = document.createElement("button");
    arrivalButton.className = "icon-text-button arrival-date-button";
    arrivalButton.type = "button";
    arrivalButton.dataset.editProductArrival = product.skuKey;
    arrivalButton.textContent = annotation.arrivalDate ? "ערוך הגעה" : "תאריך הגעה";
    actions.append(arrivalButton);

    const tools = document.createElement("div");
    tools.className = "item-tools";

    if (!isDiscontinued && !shouldAskForCartCustomer()) {
      const inlineFields = document.createElement("div");
      inlineFields.className = "inline-add-fields";
      const quantity = createQuantitySelectField("כמות", 1, {
        min: 1,
        step: 1,
        attr: "addQuantity",
        key: product.skuKey,
      });
      const priceInput = createNumberField("מחיר ליחידה", product.price, {
        min: 0,
        step: 0.01,
        attr: "addPrice",
        key: product.skuKey,
      });
      quantity.classList.add("inline-add-field");
      priceInput.classList.add("inline-add-field");
      inlineFields.append(quantity, priceInput);
      tools.append(inlineFields);

      const last = lastPrices[product.skuKey];
      if (product.price > 0 || Number.isFinite(last?.price)) {
        const inlineQuickPrices = document.createElement("div");
        inlineQuickPrices.className = "quick-prices inline-quick-prices";
        if (product.price > 0) {
          const displayButton = createDisplayDiscountButton(product.price);
          displayButton.dataset.useAddDisplayPrice = product.skuKey;
          setDisplayDiscountButtonPrice(displayButton, product.price);
          inlineQuickPrices.append(displayButton);
        }
        if (Number.isFinite(last?.price)) inlineQuickPrices.append(createLastPriceReference(last.price));
        tools.append(inlineQuickPrices);
      }

      const reservation = orderType === "delivery" ? getCustomerReservation(getSelectedCustomer(), product.skuKey) : null;
      if (reservation?.quantity > 0) {
        const reservationToggle = createReservationToggle(
          `מהשריון · נותרו ${reservation.quantity.toLocaleString("he-IL")} יח׳`,
          "addReservation",
          product.skuKey,
          true,
        );
        reservationToggle.classList.add("inline-reservation-toggle");
        priceInput.querySelector("span").textContent = "מחיר ליתרה מעבר לשריון";
        tools.append(reservationToggle);
      }
    }

    content.append(sku, description, annotationMeta);
    main.append(content, price);
    tools.append(actions);
    article.append(main, tools);
    return article;
  });
}

function getProductDocuments(product) {
  const skuKey = getSkuKey(product.sku);
  const direct = specManifest.items[skuKey];
  const item = direct?.url ? direct : specManifest.lookup[getModelKey(product.sku)];
  if (!item?.url) return [];

  const files = Array.isArray(item.files) && item.files.length ? item.files : [item];
  const productSheet = files.find((file) => !file.installation);
  const installation = files.find((file) => file.installation);
  return [productSheet, installation].filter(Boolean);
}

function isDiscontinuedCategory(category) {
  const key = normalizeSearch(category).replace(/\s+/g, "");
  return key === "יצאממגוון" || key === "יצאמהמגוון" || key === "יצאמהמהגוון";
}

function getDiscontinuedCategoryName() {
  const existing = categories.find(isDiscontinuedCategory);
  if (existing) return existing;

  const category = "יצא ממגוון";
  categories = [...categories, category].sort((a, b) => a.localeCompare(b, "he"));
  return category;
}

function emptyState(message) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

function buildStatus(query, activeCategory, count) {
  if (!products.length) return "";
  if (!query && !activeCategory) return "מוצגים הפריטים הראשונים.";
  const label = count === 1 ? "התאמה אחת" : `${count.toLocaleString("he-IL")} התאמות`;
  return label;
}

function addCategoryFromInput() {
  const category = cleanString(dom.categoryInput.value);
  if (!category) return;

  const exists = categories.some((existing) => normalizeSearch(existing) === normalizeSearch(category));
  if (!exists) {
    categories = [...categories, category].sort((a, b) => a.localeCompare(b, "he"));
    saveCategories();
  }

  dom.categoryInput.value = "";
  render();
}

function editCategory(category) {
  if (!categories.includes(category)) return;
  const nextName = cleanString(window.prompt("שם הקטגוריה", category));
  if (!nextName || nextName === category) return;
  if (categories.some((item) => item !== category && normalizeSearch(item) === normalizeSearch(nextName))) {
    dom.status.textContent = "כבר קיימת קטגוריה בשם הזה.";
    return;
  }

  categories = categories.map((item) => (item === category ? nextName : item)).sort((a, b) => a.localeCompare(b, "he"));
  Object.values(annotations).forEach((annotation) => {
    if (annotation.category === category) annotation.category = nextName;
  });
  saveCategories();
  saveAnnotations();
  render();
  dom.status.textContent = "שם הקטגוריה עודכן.";
}

function deleteCategory(category) {
  if (!categories.includes(category)) return;
  const productCount = getCategoryCounts().get(category) || 0;
  const detail = productCount ? ` הקטגוריה משויכת ל-${productCount} מוצרים והשיוך יוסר.` : "";
  if (!window.confirm(`למחוק את הקטגוריה \"${category}\"?${detail}`)) return;

  categories = categories.filter((item) => item !== category);
  Object.entries(annotations).forEach(([key, annotation]) => {
    if (annotation.category !== category) return;
    if (annotation.note || annotation.arrivalDate) {
      annotations[key] = { ...annotation, category: "" };
    } else {
      delete annotations[key];
    }
  });
  saveCategories();
  saveAnnotations();
  render();
  dom.status.textContent = "הקטגוריה נמחקה.";
}

function updateAnnotation(productKey, patch) {
  if (!productKey) return;
  const current = annotations[productKey] || { category: "", note: "", arrivalDate: "" };
  const next = {
    category: cleanString(patch.category ?? current.category),
    note: cleanString(patch.note ?? current.note),
    arrivalDate: normalizeDateInput(patch.arrivalDate ?? current.arrivalDate),
  };

  if (!next.category && !next.note && !next.arrivalDate) {
    delete annotations[productKey];
  } else {
    annotations[productKey] = next;
  }

  saveAnnotations();
}

function openNoteDialog(product) {
  pendingNoteProduct = product;
  const annotation = getAnnotation(product);
  dom.noteProductSummary.textContent = `${product.sku || "ללא מק״ט"} · ${product.description || "ללא תיאור"}`;
  dom.noteInput.value = annotation.note || "";
  dom.deleteNote.hidden = !annotation.note;
  dom.noteDialog.hidden = false;
  document.body.classList.add("dialog-open");
  window.setTimeout(() => dom.noteInput.focus(), 50);
}

function closeNoteDialog() {
  pendingNoteProduct = null;
  dom.noteDialog.hidden = true;
  dom.noteInput.value = "";
  document.body.classList.remove("dialog-open");
}

function saveProductNote(event) {
  event.preventDefault();
  if (!pendingNoteProduct) return;
  updateAnnotation(pendingNoteProduct.skuKey, { note: dom.noteInput.value });
  closeNoteDialog();
  render();
  dom.status.textContent = "ההערה נשמרה.";
}

function deleteProductNote() {
  if (!pendingNoteProduct) return;
  updateAnnotation(pendingNoteProduct.skuKey, { note: "" });
  closeNoteDialog();
  render();
  dom.status.textContent = "ההערה נמחקה.";
}

function openArrivalDialog(product) {
  pendingArrivalProduct = product;
  const annotation = getAnnotation(product);
  dom.arrivalProductSummary.textContent = `${product.sku || "ללא מק״ט"} · ${product.description || "ללא תיאור"}`;
  dom.arrivalDateInput.min = getLocalDateKey(new Date());
  dom.arrivalDateInput.value = annotation.arrivalDate || "";
  dom.deleteArrival.hidden = !annotation.arrivalDate;
  dom.arrivalDialog.hidden = false;
  document.body.classList.add("dialog-open");
  window.setTimeout(() => dom.arrivalDateInput.focus(), 50);
}

function closeArrivalDialog() {
  pendingArrivalProduct = null;
  dom.arrivalDialog.hidden = true;
  dom.arrivalDateInput.value = "";
  document.body.classList.remove("dialog-open");
}

function saveProductArrivalDate(event) {
  event.preventDefault();
  if (!pendingArrivalProduct) return;
  const arrivalDate = normalizeDateInput(dom.arrivalDateInput.value);
  if (!arrivalDate) {
    dom.status.textContent = "יש לבחור תאריך הגעה.";
    dom.arrivalDateInput.focus();
    return;
  }
  updateAnnotation(pendingArrivalProduct.skuKey, { arrivalDate });
  closeArrivalDialog();
  render();
  dom.status.textContent = "תאריך ההגעה נשמר.";
}

function deleteProductArrivalDate() {
  if (!pendingArrivalProduct) return;
  updateAnnotation(pendingArrivalProduct.skuKey, { arrivalDate: "" });
  closeArrivalDialog();
  render();
  dom.status.textContent = "תאריך ההגעה נמחק.";
}

function isActiveArrivalDate(value, reference = new Date()) {
  const arrivalDate = normalizeDateInput(value);
  return Boolean(arrivalDate && arrivalDate >= getLocalDateKey(reference));
}

function formatArrivalDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("he-IL");
}

function getAnnotation(product) {
  return annotations[product.skuKey || getSkuKey(product.sku)] || { category: "", note: "", arrivalDate: "" };
}

function getCategoryCounts() {
  return products.reduce((counts, product) => {
    const category = getAnnotation(product).category;
    if (!category) return counts;
    counts.set(category, (counts.get(category) || 0) + 1);
    return counts;
  }, new Map());
}

function renderCustomerOptions() {
  const options = customers.map((customer) => {
    const option = document.createElement("option");
    option.value = customer.name;
    option.label = [customer.code, customer.phone].filter(Boolean).join(" · ");
    return option;
  });

  dom.customerOptions.replaceChildren(...options.map((option) => option.cloneNode(true)));
  dom.cartCustomerOptions.replaceChildren(...options);
}

function renderCustomerHint() {
  const customer = getSelectedCustomer();
  if (!customer) {
    dom.customerHint.textContent = dom.customerName.value
      ? orderType === "reservation"
        ? "לרכישה לשריון צריך לבחור לקוח קיים."
        : "לא משויך ללקוח קיים."
      : "";
    return;
  }

  const details = [customer.code ? `קוד ${customer.code}` : "", customer.phone].filter(Boolean).join(" · ");
  dom.customerHint.textContent = details ? `משויך: ${details}` : "משויך ללקוח קיים.";
}

function renderCustomersPanel() {
  const query = normalizeSearch(dom.customerSearch.value);
  const visibleCustomers = customers
    .filter((customer) => {
      if (!query) return true;
      return normalizeSearch(`${customer.name} ${customer.code} ${customer.phone}`).includes(query);
    })
    .slice(0, 80);

  dom.customersSummary.textContent =
    customers.length === 1 ? "לקוח אחד" : `${customers.length.toLocaleString("he-IL")} לקוחות`;

  if (!visibleCustomers.length) {
    dom.customersList.replaceChildren(emptyState("לא נמצאו לקוחות."));
  } else {
    dom.customersList.replaceChildren(...visibleCustomers.map(renderCustomerCard));
  }

  renderCustomerOrders();
}

function renderCustomerCard(customer) {
  const customerOrders = getOrdersForCustomer(customer);
  const stats = getOrderStats(customerOrders);
  const card = document.createElement("article");
  card.className = "customer-card";
  card.dataset.viewCustomer = customer.id;
  card.setAttribute("aria-selected", String(customer.id === activeCustomerId));

  const body = document.createElement("div");
  body.className = "customer-body";
  const details = [customer.code ? `קוד: ${customer.code}` : "", customer.phone ? `טל׳: ${customer.phone}` : ""]
    .filter(Boolean)
    .join(" · ");
  body.innerHTML = `
    <strong>${escapeHtml(customer.name)}</strong>
    <span>${escapeHtml(details || "ללא קוד או טלפון")}</span>
    <small>${escapeHtml(stats.orderCount ? `${stats.orderCount.toLocaleString("he-IL")} הזמנות` : "אין הזמנות עדיין")}</small>
  `;
  body.append(createCustomerTotals(stats));
  const displaySales = getCustomerDisplaySales(customerOrders);
  if (displaySales.length) body.append(renderCustomerDisplaySales(displaySales));

  const actions = document.createElement("div");
  actions.className = "customer-actions";

  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "secondary-button";
  choose.dataset.chooseCustomer = customer.id;
  choose.textContent = "בחר להזמנה";

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary-button";
  edit.dataset.editCustomer = customer.id;
  edit.textContent = "ערוך";

  const viewOrders = document.createElement("button");
  viewOrders.type = "button";
  viewOrders.className = "secondary-button";
  viewOrders.dataset.viewCustomerOrders = customer.id;
  viewOrders.textContent = "הצג הזמנות";

  actions.append(viewOrders, choose, edit);
  card.append(body, actions);
  return card;
}

function getCustomerDisplaySales(customerOrders) {
  const grouped = new Map();
  customerOrders.forEach((order) => {
    order.items.forEach((item) => {
      if (isReservationOrderItem(item) || item.priceSource !== "display") return;
      const skuKey = item.skuKey || getSkuKey(item.sku || item.description);
      const key = skuKey || `${item.sku || ""}-${item.description || ""}`;
      const quantity = parseQuantity(item.quantity);
      const lineTotal = getOrderItemLineTotal(item);
      const reportDate = getOrderReportDateKey(order);
      const current = grouped.get(key) || {
        sku: item.sku || "ללא מק״ט",
        description: item.description || "ללא תיאור",
        quantity: 0,
        total: 0,
        latestDate: "",
        sales: [],
      };

      current.quantity += quantity;
      current.total = roundMoney(current.total + lineTotal);
      current.latestDate = current.latestDate && current.latestDate > reportDate ? current.latestDate : reportDate;
      current.sales.push({
        orderId: order.id,
        reportDate,
        createdAt: order.createdAt,
        quantity,
        unitPrice: Number(item.unitPrice) || 0,
        total: lineTotal,
      });
      grouped.set(key, current);
    });
  });

  return [...grouped.values()]
    .map((entry) => ({
      ...entry,
      sales: entry.sales.sort((a, b) => b.reportDate.localeCompare(a.reportDate) || new Date(b.createdAt) - new Date(a.createdAt)),
    }))
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.sku.localeCompare(b.sku, "en"));
}

function renderCustomerDisplaySales(displaySales) {
  const wrapper = document.createElement("section");
  wrapper.className = "customer-display-sales";
  wrapper.setAttribute("aria-label", "תצוגות שהלקוח לקח");

  const totalQuantity = displaySales.reduce((sum, entry) => sum + entry.quantity, 0);
  const title = document.createElement("strong");
  title.className = "customer-display-title";
  title.textContent = `תצוגות שנלקחו · ${totalQuantity.toLocaleString("he-IL")} יח׳`;

  wrapper.replaceChildren(title, ...displaySales.map(renderCustomerDisplaySale));
  return wrapper;
}

function renderCustomerDisplaySale(entry) {
  const details = document.createElement("details");
  details.className = "customer-display-item";

  const summary = document.createElement("summary");
  summary.innerHTML = `
    <span>
      <strong>${escapeHtml(entry.sku)}</strong>
      <small>${escapeHtml(entry.description)}</small>
    </span>
    <b>${escapeHtml(entry.quantity.toLocaleString("he-IL"))} יח׳</b>
  `;

  const dates = document.createElement("div");
  dates.className = "customer-display-dates";
  entry.sales.forEach((sale) => {
    const row = document.createElement("div");
    row.innerHTML = `
      <span>${escapeHtml(formatReminderDate(sale.reportDate))}</span>
      <b>${escapeHtml(sale.quantity.toLocaleString("he-IL"))} יח׳ · ${escapeHtml(formatPrice(sale.unitPrice))}</b>
    `;
    dates.append(row);
  });

  details.append(summary, dates);
  return details;
}

function getOrderItemLineTotal(item) {
  const storedTotal = Number(item.lineTotal);
  if (Number.isFinite(storedTotal)) return roundMoney(storedTotal);
  return roundMoney(parseQuantity(item.quantity) * (Number(item.unitPrice) || 0));
}

function renderCustomerOrders() {
  const customer = customers.find((item) => item.id === activeCustomerId) || null;
  if (!customer) {
    dom.customerHistoryTitle.textContent = "הזמנות לקוח";
    dom.customerOrders.replaceChildren(emptyState("בחר לקוח כדי לראות הזמנות עבר."));
    return;
  }

  const customerOrders = getOrdersForCustomer(customer);
  dom.customerHistoryTitle.textContent = `הזמנות ${customer.name}`;

  if (!customerOrders.length) {
    dom.customerOrders.replaceChildren(emptyState("אין הזמנות שמורות ללקוח הזה."));
    return;
  }

  const stats = createCustomerTotals(getOrderStats(customerOrders), "customer-history-totals");
  dom.customerOrders.replaceChildren(stats, ...customerOrders.map(renderCustomerOrderDetails));
}

function createCustomerTotals(stats, extraClass = "") {
  const totals = document.createElement("div");
  totals.className = `customer-totals${extraClass ? ` ${extraClass}` : ""}`;
  totals.replaceChildren(
    createCustomerPeriodTotal("החודש", stats.periods.month),
    createCustomerPeriodTotal("השנה", stats.periods.year),
    createCustomerPeriodTotal("מאז ומתמיד", stats.periods.allTime),
  );
  return totals;
}

function createCustomerPeriodTotal(label, stats) {
  const item = document.createElement("div");
  item.className = "customer-period-total";
  const gross = roundMoney(stats.paidTotal);
  const net = roundMoney(gross / (1 + VAT_RATE));
  item.innerHTML = `
    <span>${escapeHtml(label)}</span>
    <strong>${stats.quantity.toLocaleString("he-IL")} פריטים</strong>
    <b><span class="customer-money-value">${escapeHtml(formatPrice(gross))}</span><small>כולל מע״מ</small></b>
    <b><span class="customer-money-value">${escapeHtml(formatPrice(net))}</span><small>ללא מע״מ</small></b>
  `;
  return item;
}

function getOrderStats(customerOrders) {
  const now = new Date();
  return customerOrders.reduce(
    (stats, order) => {
      const orderDate = getOrderReportDate(order);
      const orderStats = getSingleOrderCustomerStats(order);
      stats.orderCount += 1;
      addCustomerPeriodStats(stats.periods.allTime, orderStats);
      if (isSameYear(orderDate, now)) addCustomerPeriodStats(stats.periods.year, orderStats);
      if (isSameMonth(orderDate, now)) addCustomerPeriodStats(stats.periods.month, orderStats);
      return stats;
    },
    {
      orderCount: 0,
      periods: {
        month: createEmptyCustomerPeriodStats(),
        year: createEmptyCustomerPeriodStats(),
        allTime: createEmptyCustomerPeriodStats(),
      },
    },
  );
}

function createEmptyCustomerPeriodStats() {
  return { orderCount: 0, quantity: 0, paidTotal: 0 };
}

function getSingleOrderCustomerStats(order) {
  return {
    orderCount: 1,
    quantity: order.items.reduce((sum, item) => sum + parseQuantity(item.quantity), 0),
    paidTotal: getPaidSalesTotal(order.items),
  };
}

function addCustomerPeriodStats(target, source) {
  target.orderCount += source.orderCount;
  target.quantity += source.quantity;
  target.paidTotal = roundMoney(target.paidTotal + source.paidTotal);
}

function renderCustomerOrderDetails(order) {
  const details = document.createElement("details");
  details.className = "customer-order-details";

  const date = new Date(order.createdAt).toLocaleString("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const reportLabel = getOrderReportLabel(order);
  const summary = document.createElement("summary");
  summary.innerHTML = `
    <span>
      <strong>${escapeHtml(date)}</strong>
      <small>${isReservationPurchaseOrder(order) ? "הזמנה לשריון · " : ""}${escapeHtml(itemCount.toLocaleString("he-IL"))} יחידות</small>
      ${reportLabel ? `<small>${escapeHtml(reportLabel)}</small>` : ""}
    </span>
    <b>${escapeHtml(formatPrice(order.total))}</b>
  `;

  const items = document.createElement("div");
  items.className = "customer-order-items";
  order.items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "customer-order-item";
    row.classList.toggle("reservation-order-item", Boolean(item.fromReservation));
    const itemTotal = Number.isFinite(item.lineTotal) && item.lineTotal > 0
      ? item.lineTotal
      : roundMoney(item.quantity * item.unitPrice);
    const unitPriceLabel = item.fromReservation
      ? "משריון"
      : isBonusOrderItem(item)
        ? `${getBonusOrderItemLabel(item)} · ₪0`
        : `${formatPrice(item.unitPrice)}${item.priceSource === "display" ? " · תצוגה" : ""}`;
    const itemTotalLabel = item.fromReservation ? "משריון" : formatPrice(itemTotal);
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.sku || "ללא מק״ט")}</strong>
        <span>${escapeHtml(item.description || "ללא תיאור")}</span>
        <small>${escapeHtml(item.quantity.toLocaleString("he-IL"))} × ${escapeHtml(unitPriceLabel)}</small>
      </div>
      <b>${escapeHtml(itemTotalLabel)}</b>
    `;
    items.append(row);
  });

  const footer = document.createElement("div");
  footer.className = "customer-order-footer";
  const total = document.createElement("strong");
  total.textContent = `סה״כ ${formatPrice(order.total)}`;
  footer.append(total, createOrderActions(order));

  details.append(summary, items, footer);
  return details;
}

function saveCustomerFromForm(event) {
  event.preventDefault();
  const id = cleanString(dom.customerId.value);
  const name = cleanString(dom.customerFormName.value);
  if (!name) return;
  const previousCustomer = customers.find((customer) => customer.id === id);

  const nextCustomer = {
    id: id || createCustomerId(name),
    code: cleanString(dom.customerCode.value),
    name,
    phone: cleanString(dom.customerPhone.value),
    createdAt: customers.find((customer) => customer.id === id)?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const duplicate = customers.find(
    (customer) => customer.id !== nextCustomer.id && normalizeSearch(customer.name) === normalizeSearch(nextCustomer.name),
  );
  if (duplicate) {
    dom.status.textContent = "לקוח בשם הזה כבר קיים.";
    activeCustomerId = duplicate.id;
    renderCustomersPanel();
    return;
  }

  customers = [
    nextCustomer,
    ...customers.filter((customer) => customer.id !== nextCustomer.id),
  ].sort((a, b) => a.name.localeCompare(b.name, "he"));

  if (previousCustomer) {
    reservations = reservations.map((reservation) =>
      reservation.customerId === nextCustomer.id
        ? { ...reservation, customerName: nextCustomer.name, updatedAt: new Date().toISOString() }
        : reservation,
    );
    saveReservations({ sync: false });
    reminders = reminders.map((reminder) =>
      reminder.customerId === nextCustomer.id
        ? { ...reminder, customerName: nextCustomer.name, updatedAt: new Date().toISOString() }
        : reminder,
    );
    saveReminders({ sync: false });
  }

  activeCustomerId = nextCustomer.id;
  if (settings.customerId === nextCustomer.id || normalizeSearch(settings.customerName) === normalizeSearch(nextCustomer.name)) {
    applyCustomerToDraft(nextCustomer);
  }

  saveCustomers();
  resetCustomerForm();
  render();
  dom.status.textContent = "הלקוח נשמר.";
}

function openNewCustomerForm() {
  resetCustomerForm();
  setActiveTab("customers");
  renderCustomersPanel();
  dom.customerForm.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => dom.customerFormName.focus(), 50);
}

function editCustomer(customerId) {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) return;
  activeCustomerId = customer.id;
  dom.customerId.value = customer.id;
  dom.customerCode.value = customer.code || "";
  dom.customerFormName.value = customer.name;
  dom.customerPhone.value = customer.phone || "";
  dom.customerFormName.focus();
  renderCustomersPanel();
}

function resetCustomerForm() {
  dom.customerId.value = "";
  dom.customerCode.value = "";
  dom.customerFormName.value = "";
  dom.customerPhone.value = "";
}

function chooseCustomerForOrder(customerId) {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) return;
  activeCustomerId = customer.id;
  applyCustomerToDraft(customer);
  customerConfirmedForCurrentCart = true;
  saveSettings();
  render();
  setActiveTab("cart");
  dom.status.textContent = "הלקוח שויך להזמנה הנוכחית.";
}

function applyCustomerToDraft(customer) {
  settings.customerId = customer.id;
  settings.customerName = customer.name;
  dom.customerName.value = customer.name;
  duplicatedOrderNeedsCustomer = false;
}

function clearDraftCustomer() {
  settings.customerId = "";
  settings.customerName = "";
  dom.customerName.value = "";
  customerConfirmedForCurrentCart = false;
}

function getSelectedCustomer() {
  return (
    customers.find((customer) => customer.id === settings.customerId) ||
    findCustomerByName(settings.customerName || dom.customerName.value)
  );
}

function findCustomerByName(name) {
  const normalized = normalizeSearch(name);
  if (!normalized) return null;
  return customers.find((customer) => normalizeSearch(customer.name) === normalized) || null;
}

function findCustomerByLooseName(name) {
  const exact = findCustomerByName(name);
  if (exact) return exact;
  const identity = normalizeCustomerIdentity(name);
  if (!identity) return null;
  const identityMatch = customers.find((customer) => normalizeCustomerIdentity(customer.name) === identity);
  if (identityMatch) return identityMatch;
  const flexibleIdentity = normalizeCustomerIdentityWithSortedNumbers(name);
  return (
    customers.find(
      (customer) => normalizeCustomerIdentityWithSortedNumbers(customer.name) === flexibleIdentity,
    ) || null
  );
}

function getOrdersForCustomer(customer) {
  const normalizedName = normalizeSearch(customer.name);
  return orders.filter((order) => order.customerId === customer.id || normalizeSearch(order.customerName) === normalizedName);
}

function getOrderCustomer(order) {
  return (
    customers.find((customer) => customer.id === order.customerId) ||
    findCustomerByName(order.customerName) ||
    null
  );
}

function renderReservationsPanel() {
  const currentFilter = dom.reservationCustomerFilter.value;
  const reservationCustomers = customers.filter((customer) =>
    reservations.some((reservation) => reservation.customerId === customer.id),
  );

  dom.reservationCustomerFilter.replaceChildren(createOption("", "כל הלקוחות", !currentFilter));
  reservationCustomers.forEach((customer) => {
    dom.reservationCustomerFilter.append(createOption(customer.id, customer.name, currentFilter === customer.id));
  });
  if (currentFilter && !reservationCustomers.some((customer) => customer.id === currentFilter)) {
    dom.reservationCustomerFilter.value = "";
  }

  const selectedAddCustomer = dom.reservationCustomer.value;
  dom.reservationCustomer.replaceChildren(createOption("", "בחר לקוח", !selectedAddCustomer));
  customers.forEach((customer) => {
    dom.reservationCustomer.append(createOption(customer.id, customer.name, selectedAddCustomer === customer.id));
  });

  dom.reservationProductOptions.replaceChildren(
    ...products.map((product) => {
      const option = document.createElement("option");
      option.value = product.sku;
      option.label = product.description;
      return option;
    }),
  );

  const totalUnits = reservations.reduce((sum, reservation) => sum + reservation.quantity, 0);
  const activeCustomers = new Set(reservations.filter((reservation) => reservation.quantity > 0).map((item) => item.customerId));
  const lowStockCount = reservations.filter(isLowReservationEntry).length;
  const reservationValue = getCurrentReservationValue();
  const monthlyReleaseValue = getMonthlyReservationReleaseValue();
  const missingPriceModels = getReservationModelsWithoutListPrice();
  const missingPriceNote = missingPriceModels.length
    ? `<small>לא כולל ${missingPriceModels.length.toLocaleString("he-IL")} דגמים ללא מחיר עדכני</small>`
    : "";
  dom.reservationsSummary.textContent = `${totalUnits.toLocaleString("he-IL")} יחידות`;
  dom.reservationStats.innerHTML = `
    <div><span>לקוחות עם מלאי</span><strong>${activeCustomers.size.toLocaleString("he-IL")}</strong></div>
    <div><span>דגמים בשריון</span><strong>${reservations.length.toLocaleString("he-IL")}</strong></div>
    <div class="reservation-value"><span>שווי השריון לפי מחירון</span><strong>${escapeHtml(formatPrice(reservationValue))}</strong>${missingPriceNote}</div>
    <div class="reservation-value"><span>שווי יציאות משריון החודש</span><strong>${escapeHtml(formatPrice(monthlyReleaseValue))}</strong></div>
    <div class="reservation-low-count ${lowStockCount ? "low" : ""}"><span>יתרות מתחת ל־2</span><strong>${lowStockCount.toLocaleString("he-IL")}</strong></div>
  `;

  const filterCustomerId = dom.reservationCustomerFilter.value;
  const query = normalizeSearch(dom.reservationSearch.value);
  const visible = reservations.filter((reservation) => {
    if (filterCustomerId && reservation.customerId !== filterCustomerId) return false;
    if (!query) return true;
    return normalizeSearch(`${reservation.sku} ${getReservationDescription(reservation)}`).includes(query);
  });

  if (!visible.length) {
    dom.reservationsList.replaceChildren(emptyState("לא נמצאו שריונים."));
    return;
  }

  const grouped = visible.reduce((groups, reservation) => {
    const entries = groups.get(reservation.customerId) || [];
    entries.push(reservation);
    groups.set(reservation.customerId, entries);
    return groups;
  }, new Map());

  const groups = [...grouped.entries()]
    .map(([customerId, entries]) => renderReservationCustomerGroup(customerId, entries, Boolean(filterCustomerId || query)))
    .filter(Boolean);
  dom.reservationsList.replaceChildren(...groups);
}

function renderReservationCustomerGroup(customerId, entries, open = false) {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) return null;

  const card = document.createElement("details");
  card.className = "reservation-customer-card";
  card.dataset.reservationCustomer = customer.id;
  card.open = open || openReservationCustomerIds.has(customer.id);

  const header = document.createElement("summary");
  header.className = "reservation-customer-header";
  const title = document.createElement("div");
  const missingPriceModels = new Set();
  const reservationValue = entries.reduce((sum, entry) => {
    const price = getReservationListPrice(entry.skuKey || entry.sku);
    if (price === null) {
      missingPriceModels.add(getModelKey(entry.skuKey || entry.sku));
      return sum;
    }
    return sum + entry.quantity * price;
  }, 0);
  const missingPriceLabel = missingPriceModels.size
    ? ` · ${missingPriceModels.size.toLocaleString("he-IL")} ללא מחיר`
    : "";
  title.innerHTML = `<strong>${escapeHtml(customer.name)}</strong><span>${entries.length.toLocaleString("he-IL")} דגמים${missingPriceLabel}</span>`;
  const total = document.createElement("b");
  const totalUnits = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  total.textContent = `${totalUnits.toLocaleString("he-IL")} יח׳ · ${formatPrice(reservationValue)}`;
  if (missingPriceModels.size) {
    total.title = `הסכום לא כולל ${missingPriceModels.size.toLocaleString("he-IL")} דגמים ללא מחיר עדכני`;
  }
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "secondary-button reservation-export-button";
  exportButton.dataset.exportReservations = customer.id;
  exportButton.textContent = "ייצא Excel";
  exportButton.setAttribute("aria-label", `ייצא את השריון של ${customer.name} לקובץ Excel`);
  title.append(exportButton);
  header.append(title, total);

  const pendingChangeCount = getPendingReservationChanges(customer.id).length;
  const saveActions = document.createElement("div");
  saveActions.className = "reservation-customer-save-actions";
  saveActions.innerHTML = `
    <span class="reservation-save-status" data-reservation-save-status>${pendingChangeCount ? `${pendingChangeCount.toLocaleString("he-IL")} שינויים ממתינים לשמירה` : "ערוך כמויות ולחץ שמור"}</span>
    <button
      class="file-button reservation-save-button"
      type="button"
      data-save-reservation-customer="${escapeHtml(customer.id)}"
      ${pendingChangeCount ? "" : "disabled"}
    >שמור שינויים</button>
  `;
  card.classList.toggle("has-pending-reservation-changes", pendingChangeCount > 0);

  const rows = entries
    .sort((a, b) => a.sku.localeCompare(b.sku, "en"))
    .map(renderReservationRow);
  card.append(header, saveActions, ...rows);
  return card;
}

function renderReservationRow(reservation) {
  const row = document.createElement("div");
  row.className = "reservation-row";
  if (isLowReservationEntry(reservation)) row.classList.add("low-stock");

  const product = document.createElement("div");
  product.className = "reservation-product";
  const stockLabel = reservation.quantity === 0 ? "אזל" : reservation.quantity === 1 ? "יחידה אחרונה" : "במלאי";
  product.innerHTML = `
    <strong>${escapeHtml(reservation.sku)}</strong>
    <span>${escapeHtml(getReservationDescription(reservation))}</span>
    <small>${stockLabel}</small>
  `;

  const controls = document.createElement("div");
  controls.className = "reservation-row-controls";
  const quantity = document.createElement("input");
  quantity.type = "number";
  quantity.inputMode = "numeric";
  quantity.min = "0";
  quantity.step = "1";
  const pendingQuantity = pendingReservationQuantities.get(reservation.id);
  quantity.value = String(pendingQuantity ?? reservation.quantity);
  quantity.dataset.reservationQuantity = reservation.id;
  quantity.setAttribute("aria-label", `כמות שנותרה עבור ${reservation.sku}`);
  quantity.classList.toggle("is-dirty", pendingQuantity !== undefined);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-button compact-danger";
  remove.dataset.deleteReservation = reservation.id;
  remove.textContent = "מחק";
  controls.append(quantity, remove);
  row.append(product, controls);
  return row;
}

function addReservationFromForm(event) {
  event.preventDefault();
  const customer = customers.find((item) => item.id === dom.reservationCustomer.value);
  const sku = cleanString(dom.reservationProduct.value);
  const skuKey = getSkuKey(sku);
  const quantity = parseQuantity(dom.reservationQuantity.value);
  if (!customer || !skuKey) return;

  const product = products.find((item) => item.skuKey === skuKey);
  const existing = getCustomerReservation(customer, skuKey);
  if (existing) {
    existing.quantity += quantity;
    existing.updatedAt = new Date().toISOString();
  } else {
    reservations.push({
      id: createReservationId(customer.id, skuKey),
      customerId: customer.id,
      customerName: customer.name,
      skuKey,
      sku: product?.sku || sku,
      description: product?.description || "",
      quantity,
      updatedAt: new Date().toISOString(),
    });
  }

  dom.reservationProduct.value = "";
  dom.reservationQuantity.value = "1";
  saveReservations();
  renderReservationsPanel();
  dom.status.textContent = `${sku} נוסף לשריון של ${customer.name}.`;
}

function stageReservationQuantity(reservationId, value, input = null) {
  const reservation = reservations.find((item) => item.id === reservationId);
  if (!reservation) return;

  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    pendingReservationQuantities.delete(reservation.id);
    input?.classList.add("is-invalid");
    updateReservationCustomerSaveUi(reservation.customerId);
    return;
  }

  const nextQuantity = parseNonNegativeInteger(rawValue);
  if (nextQuantity === reservation.quantity) {
    pendingReservationQuantities.delete(reservation.id);
  } else {
    pendingReservationQuantities.set(reservation.id, nextQuantity);
  }
  input?.classList.toggle("is-dirty", pendingReservationQuantities.has(reservation.id));
  input?.classList.remove("is-invalid");
  openReservationCustomerIds.add(reservation.customerId);
  updateReservationCustomerSaveUi(reservation.customerId);
}

function getPendingReservationChanges(customerId) {
  return reservations
    .filter((reservation) => reservation.customerId === customerId && pendingReservationQuantities.has(reservation.id))
    .map((reservation) => ({ reservation, quantity: pendingReservationQuantities.get(reservation.id) }));
}

function updateReservationCustomerSaveUi(customerId) {
  const card = [...dom.reservationsList.querySelectorAll("[data-reservation-customer]")]
    .find((item) => item.dataset.reservationCustomer === customerId);
  if (!card) return;

  const pendingChangeCount = getPendingReservationChanges(customerId).length;
  const saveButton = card.querySelector("[data-save-reservation-customer]");
  const status = card.querySelector("[data-reservation-save-status]");
  card.classList.toggle("has-pending-reservation-changes", pendingChangeCount > 0);
  if (saveButton) saveButton.disabled = pendingChangeCount === 0;
  if (status) {
    status.textContent = pendingChangeCount
      ? `${pendingChangeCount.toLocaleString("he-IL")} שינויים ממתינים לשמירה`
      : "ערוך כמויות ולחץ שמור";
  }
}

function saveReservationCustomerChanges(customerId) {
  const changes = getPendingReservationChanges(customerId);
  if (!changes.length) {
    updateReservationCustomerSaveUi(customerId);
    return;
  }

  const now = new Date().toISOString();
  changes.forEach(({ reservation, quantity }) => {
    reservation.quantity = quantity;
    reservation.updatedAt = now;
    pendingReservationQuantities.delete(reservation.id);
  });
  sortReservations();
  saveReservations();
  openReservationCustomerIds.add(customerId);
  renderReservationsPanel();
  renderDashboard();
  dom.status.textContent = `${changes.length.toLocaleString("he-IL")} שינויים בשריון נשמרו.`;
}

function deleteReservation(reservationId) {
  const reservation = reservations.find((item) => item.id === reservationId);
  if (!reservation) return;
  const customer = customers.find((item) => item.id === reservation.customerId);
  if (!window.confirm(`למחוק את ${reservation.sku} מהשריון של ${customer?.name || reservation.customerName}?`)) return;
  pendingReservationQuantities.delete(reservationId);
  if (customer?.id) openReservationCustomerIds.add(customer.id);
  reservations = reservations.filter((item) => item.id !== reservationId);
  saveReservations();
  render();
}

function exportCustomerReservations(customerId) {
  const customer = customers.find((item) => item.id === customerId);
  if (!customer) return;
  const entries = reservations
    .filter((reservation) => reservation.customerId === customer.id && reservation.quantity > 0)
    .sort((a, b) => a.sku.localeCompare(b.sku, "en"));
  if (!entries.length) {
    window.alert("אין ללקוח מלאי משוריין פעיל לייצוא.");
    return;
  }

  const bytes = createReservationWorkbook(customer, entries);
  const date = new Date().toISOString().slice(0, 10);
  downloadWorkbook(bytes, `שריון - ${sanitizeFileName(customer.name)} - ${date}.xlsx`);
}

function exportFilteredReservationsReport() {
  const customerId = dom.reservationCustomerFilter.value;
  if (!customerId) {
    window.alert("בחר לקוח במסנן כדי להפיק דוח לפי לקוח.");
    return;
  }
  exportCustomerReservations(customerId);
}

function exportLowCustomerReservationsReport() {
  const customerId = dom.reservationCustomerFilter.value;
  if (!customerId) {
    window.alert("בחר לקוח במסנן כדי להפיק דוח פחות מ־2 לפי לקוח.");
    return;
  }

  const customer = customers.find((item) => item.id === customerId);
  if (!customer) return;

  const entries = getLowReservationEntries(customerId);
  if (!entries.length) {
    window.alert("אין ללקוח שנבחר שריונים עם יתרה מתחת ל־2.");
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const bytes = createReservationWorkbook(customer, entries, {
    title: "דוח שריונים - יתרה מתחת ל־2",
    sheetName: "פחות מ-2",
  });
  downloadWorkbook(bytes, `שריונים פחות מ-2 - ${sanitizeFileName(customer.name)} - ${date}.xlsx`);
}

function exportLowReservationsReport() {
  const entries = getLowReservationEntries();
  if (!entries.length) {
    window.alert("אין שריונים עם יתרה מתחת ל־2.");
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const bytes = createReservationWorkbook(
    { name: "יתרות מתחת ל־2" },
    entries,
    {
      includeCustomer: true,
      title: "דוח שריונים - יתרה מתחת ל־2",
      subjectLabel: "סוג דוח",
      sheetName: "פחות מ-2",
    },
  );
  downloadWorkbook(bytes, `שריונים פחות מ-2 - ${date}.xlsx`);
}

async function handleReservationReportUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  if (!/\.xlsx$/i.test(file.name)) {
    dom.reservationImportStatus.textContent = "אפשר להעלות כאן קובץ Excel מסוג XLSX בלבד.";
    event.target.value = "";
    return;
  }

  dom.reservationImportStatus.textContent = `קורא ובודק את ${file.name} פעמיים...`;
  dom.status.textContent = "בודק ומעדכן שריונים מדוח Excel...";

  try {
    const report = await parseReservationSpreadsheet(file, dom.reservationCustomerFilter.value);
    const message = saveImportedReservationReport(report);
    dom.reservationImportStatus.textContent = message;
    dom.status.textContent = message;
  } catch (error) {
    console.error("Reservation report import failed", error);
    const message = error.message || "לא הצלחתי לקרוא את דוח השריונים.";
    dom.reservationImportStatus.textContent = message;
    dom.status.textContent = message;
  } finally {
    event.target.value = "";
  }
}

function handlePastedReservationReport() {
  const text = dom.reservationPasteInput.value.trim();
  if (!text) {
    dom.reservationImportStatus.textContent = "הדבק את עמודות הדוח מאקסל לפני הסנכרון.";
    dom.reservationPasteInput.focus();
    return;
  }

  dom.reservationImportStatus.textContent = "בודק את הנתונים המודבקים פעמיים...";
  dom.status.textContent = "בודק ומעדכן שריונים מהדוח המודבק...";
  try {
    const rows = parsePastedReservationRows(text);
    const report = parseVerifiedReservationRows(rows, dom.reservationCustomerFilter.value);
    const message = saveImportedReservationReport(report);
    dom.reservationPasteInput.value = "";
    dom.reservationImportStatus.textContent = message;
    dom.status.textContent = message;
  } catch (error) {
    console.error("Pasted reservation report import failed", error);
    const message = error.message || "לא הצלחתי לקרוא את הדוח המודבק.";
    dom.reservationImportStatus.textContent = message;
    dom.status.textContent = message;
  }
}

function saveImportedReservationReport(report) {
  const result = applyReservationReportImport(report);
  saveReservations();
  render();

  const syncMode = report.isFullReport ? "דוח מלא סונכרן" : "שורות הדוח עודכנו";
  const details = [
    "הדוח נבדק פעמיים",
    `${syncMode}: ${result.updated.toLocaleString("he-IL")} עודכנו`,
    `${result.added.toLocaleString("he-IL")} נוספו`,
  ];
  if (result.removed) details.push(`${result.removed.toLocaleString("he-IL")} הוסרו כי אינם מופיעים בדוח המלא`);
  if (report.skippedCustomerNames.length) {
    details.push(`${report.skippedCustomerNames.length.toLocaleString("he-IL")} לקוחות לא נמצאו במערכת`);
  }
  return `${details.join(" · ")}.`;
}

async function parseReservationSpreadsheet(file, selectedCustomerId = "") {
  const firstPass = parseReservationSpreadsheetRows(await readSheet(file), selectedCustomerId);
  const secondPass = parseReservationSpreadsheetRows(await readSheet(file), selectedCustomerId);
  if (getReservationReportSignature(firstPass) !== getReservationReportSignature(secondPass)) {
    throw new Error("בדיקת הדוח הכפולה לא התאימה. לא בוצע שינוי בשריונים.");
  }
  return firstPass;
}

function parseVerifiedReservationRows(rows, selectedCustomerId = "") {
  const firstPass = parseReservationSpreadsheetRows(rows, selectedCustomerId);
  const secondPass = parseReservationSpreadsheetRows(rows, selectedCustomerId);
  if (getReservationReportSignature(firstPass) !== getReservationReportSignature(secondPass)) {
    throw new Error("בדיקת הדוח הכפולה לא התאימה. לא בוצע שינוי בשריונים.");
  }
  return firstPass;
}

function parsePastedReservationRows(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error("לא נמצאו שורות בדוח המודבק.");
  const separator = lines[0].includes("\t") ? "\t" : ",";
  return lines.map((line) => line.split(separator).map((cell) => cell.trim()));
}

function parseReservationSpreadsheetRows(rows, selectedCustomerId = "") {
  if (!rows.length) throw new Error("לא נמצאו שורות בדוח השריונים.");

  const { columns, headerRowIndex } = detectReservationColumns(rows);
  const reportCustomerName = getReservationReportCustomerName(rows, headerRowIndex);
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) || null;
  const reportCustomer = findCustomerByLooseName(reportCustomerName);
  const fallbackCustomer = reportCustomer || selectedCustomer;

  if (columns.customer === undefined && !fallbackCustomer) {
    throw new Error("לא נמצא לקוח בדוח. בחר לקוח במסנן לפני העלאת קובץ ללא עמודת לקוח.");
  }

  const entries = new Map();
  const skippedCustomerNames = new Set();
  rows.slice(headerRowIndex + 1).forEach((row) => {
    const sku = cleanString(row[columns.sku]);
    const skuKey = getSkuKey(sku);
    const quantity = parseStockQuantity(row[columns.quantity]);
    if (!skuKey || quantity === null) return;

    const customerName = columns.customer === undefined ? fallbackCustomer.name : cleanString(row[columns.customer]);
    const customer = columns.customer === undefined ? fallbackCustomer : findCustomerByLooseName(customerName);
    if (!customer) {
      if (customerName) skippedCustomerNames.add(customerName);
      return;
    }

    const key = `${customer.id}|${skuKey}`;
    const current = entries.get(key) || {
      customer,
      sku,
      skuKey,
      description: columns.description === undefined ? "" : cleanString(row[columns.description]),
      quantity: 0,
    };
    current.quantity += quantity;
    if (!current.description && columns.description !== undefined) {
      current.description = cleanString(row[columns.description]);
    }
    entries.set(key, current);
  });

  if (!entries.size) {
    throw new Error("לא נמצאו בדוח שורות תקינות עם דגם וכמות עבור לקוחות קיימים.");
  }

  const metadata = rows
    .slice(0, headerRowIndex)
    .flat()
    .map(cleanString)
    .filter(Boolean)
    .join(" ");
  const headerLabels = (rows[headerRowIndex] || []).map(normalizeHeader).filter(Boolean);
  const isOutstandingDeliveryReport =
    columns.customer !== undefined &&
    headerLabels.some((label) => hasAny(label, ["יתרה לאספקה", "outstanding delivery", "delivery balance"]));
  const isFullReport =
    normalizeSearch(metadata).includes(normalizeSearch("דוח מלאי משוריין")) || isOutstandingDeliveryReport;

  return {
    entries: [...entries.values()],
    skippedCustomerNames: [...skippedCustomerNames],
    isFullReport,
  };
}

function getReservationReportSignature(report) {
  const entries = report.entries
    .map((entry) => [entry.customer.id, entry.skuKey, entry.description, entry.quantity].join("|"))
    .sort()
    .join("\n");
  return `${report.isFullReport}|${report.skippedCustomerNames.slice().sort().join("|")}|${entries}`;
}

function detectReservationColumns(rows) {
  let best = { score: -1, columns: {}, headerRowIndex: -1 };

  rows.slice(0, 30).forEach((row, rowIndex) => {
    const columns = {};
    row.forEach((cell, columnIndex) => {
      const label = normalizeHeader(cell);
      if (!label) return;

      if (columns.customer === undefined && hasAny(label, ["לקוח", "customer", "client"])) {
        columns.customer = columnIndex;
      }
      if (columns.sku === undefined && hasAny(label, ["מקט", "sku", "item", "part", "מספר פריט", "דגם", "model"])) {
        columns.sku = columnIndex;
      }
      if (
        columns.description === undefined &&
        hasAny(label, ["תאור", "תיאור", "מוצר", "description", "desc", "name"])
      ) {
        columns.description = columnIndex;
      }
      if (
        columns.quantity === undefined &&
        hasAny(label, ["כמות", "יתרה", "reserved", "reservation", "remaining", "balance", "quantity", "qty"])
      ) {
        columns.quantity = columnIndex;
      }
    });

    const score =
      Number(columns.sku !== undefined) * 2 +
      Number(columns.quantity !== undefined) * 2 +
      Number(columns.customer !== undefined) +
      Number(columns.description !== undefined) * 0.25;
    if (score > best.score) {
      best = {
        score,
        columns,
        headerRowIndex: columns.sku !== undefined && columns.quantity !== undefined ? rowIndex : -1,
      };
    }
  });

  if (best.headerRowIndex < 0) {
    throw new Error("לא מצאתי בדוח עמודת דגם/מק״ט ועמודת כמות או יתרה.");
  }

  return best;
}

function getReservationReportCustomerName(rows, headerRowIndex) {
  for (const row of rows.slice(0, headerRowIndex)) {
    const labelIndex = row.findIndex((cell) => hasAny(normalizeHeader(cell), ["לקוח", "customer", "client"]));
    if (labelIndex < 0) continue;
    const customerName = cleanString(row[labelIndex + 1]);
    if (customerName) return customerName;
  }
  return "";
}

function applyReservationReportImport(report) {
  const now = new Date().toISOString();
  const existingByKey = new Map(reservations.map((reservation) => [`${reservation.customerId}|${reservation.skuKey}`, reservation]));
  const replacementCustomerIds = report.isFullReport
    ? new Set(report.entries.map((entry) => entry.customer.id))
    : new Set();
  const replacedReservations = reservations.filter((reservation) => replacementCustomerIds.has(reservation.customerId));
  let updated = 0;
  let added = 0;

  const importedReservations = report.entries.map((entry) => {
    const key = `${entry.customer.id}|${entry.skuKey}`;
    const previous = existingByKey.get(key);
    if (previous) updated += 1;
    else added += 1;
    return createReservationFromImport(entry, previous, now);
  });

  if (report.isFullReport) {
    reservations = normalizeReservations([
      ...reservations.filter((reservation) => !replacementCustomerIds.has(reservation.customerId)),
      ...importedReservations,
    ]);
  } else {
    const importedByKey = new Map(
      importedReservations.map((reservation) => [`${reservation.customerId}|${reservation.skuKey}`, reservation]),
    );
    reservations = normalizeReservations([
      ...reservations.filter((reservation) => !importedByKey.has(`${reservation.customerId}|${reservation.skuKey}`)),
      ...importedReservations,
    ]);
  }

  return {
    updated,
    added,
    removed: report.isFullReport ? Math.max(0, replacedReservations.length - updated) : 0,
  };
}

function createReservationFromImport(entry, previous, timestamp) {
  const product = products.find((item) => item.skuKey === entry.skuKey);
  return {
    id: previous?.id || createReservationId(entry.customer.id, entry.skuKey),
    customerId: entry.customer.id,
    customerName: entry.customer.name,
    skuKey: entry.skuKey,
    sku: product?.sku || entry.sku || previous?.sku || entry.skuKey,
    description: product?.description || entry.description || previous?.description || "",
    quantity: parseNonNegativeInteger(entry.quantity),
    updatedAt: timestamp,
  };
}

function getLowReservationEntries(customerId = "") {
  return reservations
    .filter((reservation) => isLowReservationEntry(reservation) && (!customerId || reservation.customerId === customerId))
    .sort(
      (a, b) =>
        getReservationCustomerName(a).localeCompare(getReservationCustomerName(b), "he") ||
        a.sku.localeCompare(b.sku, "en"),
    );
}

function isLowReservationEntry(reservation) {
  return reservation.quantity >= 0 && reservation.quantity < 2;
}

function downloadWorkbook(bytes, fileName) {
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function createReservationWorkbook(customer, entries, options = {}) {
  const generatedAt = new Date();
  const generatedDate = generatedAt.toLocaleDateString("he-IL");
  const totalUnits = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const includeCustomer = Boolean(options.includeCustomer);
  const lastColumn = includeCustomer ? "D" : "C";
  const reportTitle = options.title || "דוח מלאי משוריין";
  const subjectLabel = options.subjectLabel || "לקוח";
  const sheetName = options.sheetName || "שריון";
  const columnsXml = includeCustomer
    ? '<cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="3" width="62" customWidth="1"/><col min="4" max="4" width="16" customWidth="1"/></cols>'
    : '<cols><col min="1" max="1" width="20" customWidth="1"/><col min="2" max="2" width="62" customWidth="1"/><col min="3" max="3" width="16" customWidth="1"/></cols>';
  const headerCells = includeCustomer
    ? `${xlsxTextCell("A6", "לקוח", 5)}${xlsxTextCell("B6", "דגם", 5)}${xlsxTextCell("C6", "תיאור", 5)}${xlsxTextCell("D6", "כמות שנותרה", 5)}`
    : `${xlsxTextCell("A6", "דגם", 5)}${xlsxTextCell("B6", "תיאור", 5)}${xlsxTextCell("C6", "כמות שנותרה", 5)}`;
  const dataRows = entries.map((entry, index) => {
    const rowNumber = index + 7;
    return includeCustomer
      ? `<row r="${rowNumber}">${xlsxTextCell(`A${rowNumber}`, getReservationCustomerName(entry), 6)}${xlsxTextCell(
          `B${rowNumber}`,
          entry.sku,
          6,
        )}${xlsxTextCell(`C${rowNumber}`, getReservationDescription(entry), 6)}${xlsxNumberCell(
          `D${rowNumber}`,
          entry.quantity,
          7,
        )}</row>`
      : `<row r="${rowNumber}">${xlsxTextCell(`A${rowNumber}`, entry.sku, 6)}${xlsxTextCell(
          `B${rowNumber}`,
          getReservationDescription(entry),
          6,
        )}${xlsxNumberCell(`C${rowNumber}`, entry.quantity, 7)}</row>`;
  });
  const lastRow = entries.length + 6;
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A7" sqref="A7"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  ${columnsXml}
  <sheetData>
    <row r="1" ht="30" customHeight="1">${xlsxTextCell("A1", reportTitle, 1)}</row>
    <row r="2" ht="24" customHeight="1">${xlsxTextCell("A2", subjectLabel, 2)}${xlsxTextCell("B2", customer.name, 3)}</row>
    <row r="3" ht="24" customHeight="1">${xlsxTextCell("A3", "תאריך הפקה", 2)}${xlsxTextCell("B3", generatedDate, 3)}</row>
    <row r="4" ht="24" customHeight="1">${xlsxTextCell("A4", "סה״כ יחידות", 2)}${xlsxNumberCell("B4", totalUnits, 4)}</row>
    <row r="5" ht="10" customHeight="1"></row>
    <row r="6" ht="25" customHeight="1">${headerCells}</row>
    ${dataRows.join("\n    ")}
  </sheetData>
  <autoFilter ref="A6:${lastColumn}${lastRow}"/>
  <mergeCells count="4"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="B2:${lastColumn}2"/><mergeCell ref="B3:${lastColumn}3"/><mergeCell ref="B4:${lastColumn}4"/></mergeCells>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FF12332E"/><sz val="11"/><name val="Arial"/><family val="2"/></font>
  </fonts>
  <fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF071211"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF168F7C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F5F1"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD6E3DF"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="3" fontId="3" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const createdAt = generatedAt.toISOString();
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Fujicom</dc:creator><cp:lastModifiedBy>Fujicom</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified><dc:title>${escapeXml(reportTitle)}</dc:title></cp:coreProperties>`),
    "docProps/app.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Fujicom Price Search</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${escapeXml(sheetName)}</vt:lpstr></vt:vector></TitlesOfParts></Properties>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(stylesXml),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
  };
  return zipSync(files, { level: 6 });
}

function xlsxTextCell(reference, value, style) {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function xlsxNumberCell(reference, value, style) {
  return `<c r="${reference}" s="${style}"><v>${Number(value) || 0}</v></c>`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeFileName(value) {
  return cleanString(value).replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) || "לקוח";
}

function renderRemindersPanel() {
  const formCustomer = dom.reminderCustomer.value;
  dom.reminderCustomer.replaceChildren(createOption("", "ללא שיוך ללקוח", !formCustomer));
  customers.forEach((customer) => {
    dom.reminderCustomer.append(createOption(customer.id, customer.name, formCustomer === customer.id));
  });

  const filterCustomer = dom.reminderCustomerFilter.value;
  dom.reminderCustomerFilter.replaceChildren(createOption("", "כל הלקוחות", !filterCustomer));
  customers
    .filter((customer) => reminders.some((reminder) => reminder.customerId === customer.id))
    .forEach((customer) => {
      dom.reminderCustomerFilter.append(createOption(customer.id, customer.name, filterCustomer === customer.id));
    });

  const openCount = reminders.filter((reminder) => !reminder.completed).length;
  const todayKey = getLocalDateKey(new Date());
  const todayOpenCount = reminders.filter((reminder) => !reminder.completed && reminder.dueDate === todayKey).length;
  renderHeaderReminders(todayOpenCount);
  const status = dom.reminderStatusFilter.value || "open";
  const showingToday = remindersDateFilter === todayKey;
  dom.remindersSummary.textContent = showingToday
    ? `${todayOpenCount.toLocaleString("he-IL")} פתוחות היום · ${openCount.toLocaleString("he-IL")} פתוחות בסה״כ`
    : `${openCount.toLocaleString("he-IL")} פתוחות · ${reminders.length.toLocaleString("he-IL")} סה״כ`;
  dom.showAllReminders.textContent = showingToday
    ? "הצג את כל התזכורות"
    : status === "all"
      ? "מציג הכל"
      : "הצג את כל התזכורות";
  dom.showAllReminders.disabled = !showingToday && status === "all";
  const customerId = dom.reminderCustomerFilter.value;
  const visible = reminders
    .filter((reminder) => {
      if (status === "open" && reminder.completed) return false;
      if (status === "done" && !reminder.completed) return false;
      if (showingToday && reminder.dueDate !== todayKey) return false;
      return !customerId || reminder.customerId === customerId;
    })
    .sort(compareReminders);

  if (!visible.length) {
    dom.remindersList.replaceChildren(
      emptyState(
        showingToday
          ? "אין תזכורות פתוחות להיום."
          : status === "all"
            ? "אין תזכורות שמורות."
            : status === "done"
              ? "אין תזכורות שבוצעו."
              : "אין תזכורות פתוחות.",
      ),
    );
    renderCalendarPanel();
    return;
  }
  dom.remindersList.replaceChildren(...visible.map(renderReminderRow));
  renderCalendarPanel();
}

function renderHeaderReminders(todayOpenCount) {
  if (!dom.headerReminders || !dom.headerRemindersBadge) return;
  const hasOpenToday = todayOpenCount > 0;
  dom.headerRemindersBadge.hidden = !hasOpenToday;
  dom.headerRemindersBadge.textContent = todayOpenCount.toLocaleString("he-IL");
  dom.headerReminders.setAttribute(
    "aria-label",
    hasOpenToday
      ? `${todayOpenCount.toLocaleString("he-IL")} תזכורות פתוחות להיום. פתח תזכורות`
      : "אין תזכורות פתוחות להיום. פתח תזכורות",
  );
}

function renderReminderRow(reminder) {
  const row = document.createElement("article");
  row.className = "reminder-row";
  row.classList.toggle("completed", reminder.completed);
  row.classList.toggle("overdue", isReminderOverdue(reminder));

  const completion = document.createElement("label");
  completion.className = "reminder-check";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = reminder.completed;
  checkbox.dataset.toggleReminder = reminder.id;
  checkbox.setAttribute("aria-label", `${reminder.completed ? "סמן כלא בוצע" : "סמן כבוצע"}: ${reminder.title}`);
  const state = document.createElement("span");
  state.textContent = reminder.completed ? "בוצע" : "לא בוצע";
  completion.append(checkbox, state);

  const body = document.createElement("div");
  body.className = "reminder-body";
  const customer = getReminderCustomer(reminder);
  const metadata = [
    reminder.dueDate ? `${isReminderOverdue(reminder) ? "באיחור · " : ""}${formatReminderDate(reminder.dueDate)}` : "ללא תאריך",
    customer?.name || reminder.customerName,
  ]
    .filter(Boolean)
    .join(" · ");
  body.innerHTML = `<strong>${escapeHtml(reminder.title)}</strong><span>${escapeHtml(metadata)}</span>`;

  const actions = document.createElement("div");
  actions.className = "reminder-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary-button";
  edit.dataset.editReminder = reminder.id;
  edit.textContent = "ערוך";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-button";
  remove.dataset.deleteReminder = reminder.id;
  remove.textContent = "מחק";
  actions.append(edit, remove);

  row.append(completion, body, actions);
  return row;
}

function saveReminderFromForm(event) {
  event.preventDefault();
  const id = cleanString(dom.reminderId.value);
  const title = cleanString(dom.reminderTitle.value);
  if (!title) return;
  const existing = reminders.find((reminder) => reminder.id === id);
  const customer = customers.find((item) => item.id === dom.reminderCustomer.value) || null;
  const now = new Date().toISOString();
  const reminder = {
    id: existing?.id || `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    dueDate: normalizeDateInput(dom.reminderDueDate.value),
    customerId: customer?.id || "",
    customerName: customer?.name || "",
    completed: Boolean(existing?.completed),
    completedAt: existing?.completedAt || "",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  reminders = [reminder, ...reminders.filter((item) => item.id !== reminder.id)];
  saveReminders();
  resetReminderForm();
  renderRemindersPanel();
  renderDashboard();
  dom.status.textContent = existing ? "התזכורת עודכנה." : "התזכורת נשמרה.";
}

function editReminder(reminderId) {
  const reminder = reminders.find((item) => item.id === reminderId);
  if (!reminder) return;
  dom.reminderId.value = reminder.id;
  dom.reminderTitle.value = reminder.title;
  dom.reminderDueDate.value = reminder.dueDate || "";
  dom.reminderCustomer.value = reminder.customerId || "";
  dom.reminderTitle.focus();
}

function resetReminderForm() {
  dom.reminderId.value = "";
  dom.reminderTitle.value = "";
  dom.reminderDueDate.value = "";
  dom.reminderCustomer.value = "";
}

function setReminderCompleted(reminderId, completed) {
  reminders = reminders.map((reminder) =>
    reminder.id === reminderId
      ? {
          ...reminder,
          completed: Boolean(completed),
          completedAt: completed ? new Date().toISOString() : "",
          updatedAt: new Date().toISOString(),
        }
      : reminder,
  );
  saveReminders();
  renderRemindersPanel();
  renderDashboard();
}

function deleteReminder(reminderId) {
  const reminder = reminders.find((item) => item.id === reminderId);
  if (!reminder || !window.confirm(`למחוק את התזכורת "${reminder.title}"?`)) return;
  reminders = reminders.filter((item) => item.id !== reminderId);
  if (dom.reminderId.value === reminderId) resetReminderForm();
  saveReminders();
  renderRemindersPanel();
  renderDashboard();
}

function startOfLocalMonth(value) {
  const date = getSafeDate(value);
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function shiftCalendarMonth(offset) {
  calendarMonthCursor = new Date(
    calendarMonthCursor.getFullYear(),
    calendarMonthCursor.getMonth() + offset,
    1,
    12,
  );
  calendarSelectedDateKey = "";
  renderCalendarPanel();
}

function renderCalendarPanel() {
  if (!dom.calendarGrid) return;

  const monthStart = startOfLocalMonth(calendarMonthCursor);
  const monthKey = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;
  const todayKey = getLocalDateKey(new Date());
  const events = getCalendarEvents();
  const eventsByDate = events.reduce((map, event) => {
    const dayEvents = map.get(event.dateKey) || [];
    dayEvents.push(event);
    map.set(event.dateKey, dayEvents);
    return map;
  }, new Map());
  const monthEvents = events.filter((event) => event.dateKey.startsWith(monthKey));
  const monthHolidayCount = monthEvents.filter((event) => event.type === "holiday").length;
  const monthSalesCount = monthEvents.filter((event) => event.type === "sales").length;

  dom.calendarGregorianLabel.textContent = monthStart.toLocaleDateString("he-IL", {
    month: "long",
    year: "numeric",
  });
  dom.calendarHebrewLabel.textContent = monthStart.toLocaleDateString("he-IL-u-ca-hebrew", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  });
  dom.calendarSummary.textContent = [
    `${monthEvents.length.toLocaleString("he-IL")} אירועים`,
    monthHolidayCount ? `${monthHolidayCount.toLocaleString("he-IL")} חגים` : "",
    monthSalesCount ? `${monthSalesCount.toLocaleString("he-IL")} ימי מכירות` : "",
  ].filter(Boolean).join(" · ");

  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - monthStart.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  dom.calendarGrid.replaceChildren(...days.map((date) => renderCalendarDay(date, eventsByDate.get(getLocalDateKey(date)) || [], {
    currentMonth: date.getMonth() === monthStart.getMonth(),
    today: getLocalDateKey(date) === todayKey,
    selected: getLocalDateKey(date) === calendarSelectedDateKey,
  })));

  renderCalendarSelectedDayEvents(eventsByDate.get(calendarSelectedDateKey) || [], calendarSelectedDateKey);
  renderCalendarZmanim();
}

async function loadZmanim() {
  if (!dom.calendarZmanim || !dom.zmanimSource) return;
  zmanimState = { ...zmanimState, status: "loading" };
  renderCalendarZmanim();

  try {
    const response = await fetch(ZMANIM_ENDPOINT, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) {
      lockApp("יש להתחבר מחדש.");
      return;
    }
    if (!response.ok) throw new Error(`Zmanim failed: ${response.status}`);
    const data = await response.json();
    zmanimState = {
      status: "ready",
      shabbat: data.shabbat || null,
      holidays: Array.isArray(data.holidays) ? data.holidays : [],
      source: cleanString(data.source),
      updatedAt: cleanString(data.updatedAt),
    };
  } catch (error) {
    console.warn("Zmanim failed", error);
    zmanimState = { ...zmanimState, status: "error" };
  }

  renderCalendarZmanim();
}

function renderCalendarZmanim() {
  if (!dom.calendarZmanim || !dom.zmanimSource) return;

  if (zmanimState.status === "loading") {
    dom.zmanimSource.textContent = "טוען זמנים…";
    dom.calendarZmanim.replaceChildren(calendarZmanimEmpty("טוען את זמני השבת והחגים לקריית אתא…"));
    return;
  }

  if (zmanimState.status !== "ready") {
    dom.zmanimSource.textContent = "הזמנים לא זמינים כרגע";
    dom.calendarZmanim.replaceChildren(calendarZmanimEmpty("לא ניתן היה לטעון כרגע את זמני השבת והחג."));
    return;
  }

  dom.zmanimSource.textContent = zmanimState.source || "קריית אתא";
  const cards = [];
  if (zmanimState.shabbat) {
    cards.push(renderZmanimCard({
      label: "שבת קרובה",
      title: zmanimState.shabbat.label || formatReminderDate(zmanimState.shabbat.date),
      date: zmanimState.shabbat.date,
      candleLighting: zmanimState.shabbat.candleLighting,
      havdalah: zmanimState.shabbat.havdalah,
    }));
  }

  zmanimState.holidays.slice(0, 3).forEach((holiday) => {
    cards.push(renderZmanimCard({
      label: "חג קרוב",
      title: holiday.title,
      date: holiday.date,
      candleLighting: holiday.candleLighting,
      havdalah: holiday.havdalah,
    }));
  });

  dom.calendarZmanim.replaceChildren(...(cards.length ? cards : [calendarZmanimEmpty("לא נמצאו זמני חג קרובים.")]));
}

function calendarZmanimEmpty(message) {
  const empty = document.createElement("p");
  empty.className = "calendar-zmanim-empty";
  empty.textContent = message;
  return empty;
}

function renderZmanimCard(item) {
  const card = document.createElement("article");
  card.className = "calendar-zmanim-card";
  const details = [
    item.candleLighting ? `כניסה ${item.candleLighting}` : "כניסה לא רלוונטית",
    item.havdalah ? `יציאה ${item.havdalah}` : "יציאה לא רלוונטית",
  ];
  card.innerHTML = `
    <span>${escapeHtml(item.label)}</span>
    <strong>${escapeHtml(item.title || "מועד")}</strong>
    <small>${escapeHtml(item.date ? formatReminderDate(item.date) : "")}</small>
    <div>${details.map((detail) => `<b>${escapeHtml(detail)}</b>`).join("")}</div>
  `;
  return card;
}

function getCalendarEvents() {
  const reminderEvents = reminders
    .map((reminder) => {
      const dateKey = normalizeDateInput(reminder.dueDate);
      if (!dateKey) return null;
      const customer = getReminderCustomer(reminder);
      return {
        id: `reminder-${reminder.id}`,
        dateKey,
        type: "reminder",
        title: reminder.title || "תזכורת",
        detail: [reminder.completed ? "בוצעה" : "תזכורת", customer?.name || reminder.customerName].filter(Boolean).join(" · "),
        completed: Boolean(reminder.completed),
      };
    })
    .filter(Boolean);

  const arrivalEvents = products
    .map((product) => {
      const dateKey = normalizeDateInput(getAnnotation(product).arrivalDate);
      if (!dateKey) return null;
      return {
        id: `arrival-${product.skuKey}`,
        dateKey,
        type: "arrival",
        title: `חוזר למלאי · ${product.sku || "ללא מק״ט"}`,
        detail: product.description || "מוצר",
        completed: false,
      };
    })
    .filter(Boolean);

  const holidayEvents = getIsraelHolidayEvents();
  const salesEvents = getIsraelRetailSalesEvents();
  const eventTypeOrder = { reminder: 0, arrival: 1, sales: 2, holiday: 3 };

  return [...reminderEvents, ...arrivalEvents, ...salesEvents, ...holidayEvents].sort(
    (a, b) =>
      a.dateKey.localeCompare(b.dateKey) ||
      (eventTypeOrder[a.type] ?? 9) - (eventTypeOrder[b.type] ?? 9) ||
      a.title.localeCompare(b.title, "he"),
  );
}

function getIsraelHolidayEvents(reference = new Date()) {
  const rangeStart = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 12);
  const rangeEnd = new Date(rangeStart.getFullYear() + 2, rangeStart.getMonth(), rangeStart.getDate(), 12);
  const startKey = getLocalDateKey(rangeStart);
  const endKey = getLocalDateKey(rangeEnd);
  const seen = new Set();
  const holidays = [];
  const addHoliday = (date, title, detail = "חג ישראל") => {
    const dateKey = getLocalDateKey(date);
    const eventKey = `${dateKey}-${title}`;
    if (dateKey < startKey || dateKey > endKey || seen.has(eventKey)) return;
    seen.add(eventKey);
    holidays.push({
      id: `holiday-${eventKey}`,
      dateKey,
      type: "holiday",
      title,
      detail,
      completed: false,
    });
  };

  // Show festival eves, חול המועד and אסרו חג separately so the calendar
  // remains useful for planning working days, not only the main holidays.
  const scanStart = new Date(rangeStart);
  scanStart.setDate(scanStart.getDate() - 45);
  for (const date = new Date(scanStart); date <= rangeEnd; date.setDate(date.getDate() + 1)) {
    const { day, month } = getHebrewCalendarDateParts(date);
    const isPurimMonth = month === "אדר" || month.startsWith("אדר ב");

    if (month === "אלול" && day === 29) addHoliday(date, "ערב ראש השנה", "ערב חג");
    if (month === "תשרי") {
      if (day === 1) addHoliday(date, "ראש השנה", "חג ישראל");
      if (day === 2) addHoliday(date, "ראש השנה – יום ב׳", "חג ישראל");
      if (day === 3) addHoliday(getObservedFastDate(date), "צום גדליה", "צום ומועד ישראלי");
      if (day === 9) addHoliday(date, "ערב יום כיפור", "ערב חג");
      if (day === 10) addHoliday(date, "יום כיפור", "חג ישראל");
      if (day === 14) addHoliday(date, "ערב סוכות", "ערב חג");
      if (day === 15) addHoliday(date, "סוכות", "חג ישראל");
      if (day >= 16 && day <= 20) {
        addHoliday(date, `חול המועד סוכות · יום ${day - 15}`, "חול המועד");
      }
      if (day === 21) addHoliday(date, "הושענא רבה · ערב שמיני עצרת", "מועד ישראלי");
      if (day === 22) addHoliday(date, "שמיני עצרת ושמחת תורה", "חג ישראל");
      if (day === 23) addHoliday(date, "אסרו חג סוכות", "מועד ישראלי");
    }

    if (month === "כסלו" && day === 25) {
      Array.from({ length: 8 }, (_, index) => index).forEach((index) => {
        const hanukkahDate = new Date(date);
        hanukkahDate.setDate(hanukkahDate.getDate() + index);
        addHoliday(hanukkahDate, `חנוכה · נר ${index + 1}`, "חג ישראל");
      });
    }
    if (month === "טבת" && day === 10) addHoliday(date, "עשרה בטבת", "צום ומועד ישראלי");
    if (month === "שבט" && day === 15) addHoliday(date, "ט״ו בשבט", "חג ישראל");
    if (isPurimMonth && day === 13) addHoliday(date, "תענית אסתר · ערב פורים", "צום ומועד ישראלי");
    if (isPurimMonth && day === 14) addHoliday(date, "פורים", "חג ישראל");
    if (isPurimMonth && day === 15) addHoliday(date, "שושן פורים", "מועד ישראלי");

    if (month === "ניסן") {
      if (day === 14) addHoliday(date, "ערב פסח", "ערב חג");
      if (day === 15) addHoliday(date, "פסח", "חג ישראל");
      if (day >= 16 && day <= 20) {
        addHoliday(date, `חול המועד פסח · יום ${day - 15}`, "חול המועד");
      }
      if (day === 21) addHoliday(date, "שביעי של פסח", "חג ישראל");
      if (day === 22) addHoliday(date, "אסרו חג פסח", "מועד ישראלי");
      if (day === 27) addHoliday(getObservedYomHaShoahDate(date), "יום הזיכרון לשואה ולגבורה", "מועד לאומי");
    }

    if (month === "אייר") {
      if (day === 5) {
        const independenceDay = getObservedYomHaAtzmautDate(date);
        const remembranceDay = new Date(independenceDay);
        remembranceDay.setDate(remembranceDay.getDate() - 1);
        addHoliday(remembranceDay, "יום הזיכרון", "מועד לאומי");
        addHoliday(independenceDay, "יום העצמאות", "חג לאומי");
      }
      if (day === 18) addHoliday(date, "ל״ג בעומר", "מועד ישראלי");
      if (day === 28) addHoliday(date, "יום ירושלים", "מועד לאומי");
    }

    if (month === "סיוון" && day === 5) addHoliday(date, "ערב שבועות", "ערב חג");
    if (month === "סיוון" && day === 6) addHoliday(date, "שבועות", "חג ישראל");
    if (month === "סיוון" && day === 7) addHoliday(date, "אסרו חג שבועות", "מועד ישראלי");
    if (month === "תמוז" && day === 17) addHoliday(getObservedFastDate(date), "שבעה עשר בתמוז", "צום ומועד ישראלי");
    if (month === "אב" && day === 8) addHoliday(date, "ערב תשעה באב", "ערב צום");
    if (month === "אב" && day === 9) addHoliday(getObservedFastDate(date), "תשעה באב", "צום ומועד ישראלי");
    if (month === "אב" && day === 15) addHoliday(date, "ט״ו באב", "מועד ישראלי");
  }

  return holidays;
}

function getIsraelRetailSalesEvents(reference = new Date()) {
  const rangeStart = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate(), 12);
  const rangeEnd = new Date(rangeStart.getFullYear() + 2, rangeStart.getMonth(), rangeStart.getDate(), 12);
  const startKey = getLocalDateKey(rangeStart);
  const endKey = getLocalDateKey(rangeEnd);
  const seen = new Set();
  const sales = [];
  const addSale = (date, title, detail) => {
    const dateKey = getLocalDateKey(date);
    const eventKey = `${dateKey}-${title}`;
    if (dateKey < startKey || dateKey > endKey || seen.has(eventKey)) return;
    seen.add(eventKey);
    sales.push({
      id: `sales-${eventKey}`,
      dateKey,
      type: "sales",
      title,
      detail,
      completed: false,
    });
  };

  for (let year = rangeStart.getFullYear(); year <= rangeEnd.getFullYear(); year += 1) {
    addSale(new Date(year, 1, 14, 12), "יום האהבה · קמפיין זוגיות ומתנות", "מועד מכירות עונתי");
    addSale(new Date(year, 2, 8, 12), "יום האישה הבינלאומי · קמפיין מתנות", "מועד מכירות עונתי");
    addSale(new Date(year, 7, 1, 12), "פתיחת עונת חזרה ללימודים", "חלון הכנה למבצעי אוגוסט–ספטמבר");

    const shoppingIlStart = getNthWeekdayOfGregorianMonth(year, 10, 3, 1);
    if (year === 2026) {
      addSale(new Date(year, 10, 4, 12), "ShoppingIL · יום 1", "אירוע מכירות ישראלי רשמי · 4–5 בנובמבר");
      addSale(new Date(year, 10, 5, 12), "ShoppingIL · יום 2", "אירוע מכירות ישראלי רשמי · 4–5 בנובמבר");
    } else {
      addSale(shoppingIlStart, "ShoppingIL · חלון מכירות צפוי", "המועד הסופי מתפרסם מדי שנה על־ידי Google");
      const shoppingIlDayTwo = new Date(shoppingIlStart);
      shoppingIlDayTwo.setDate(shoppingIlDayTwo.getDate() + 1);
      addSale(shoppingIlDayTwo, "ShoppingIL · המשך חלון צפוי", "המועד הסופי מתפרסם מדי שנה על־ידי Google");
    }

    addSale(new Date(year, 10, 11, 12), "יום הרווקים הסיני · 11.11", "יום מכירות אונליין חזק בישראל ובעולם");
    addSale(new Date(year, 10, 19, 12), "יום הגבר הבינלאומי", "מועד קמפיינים למתנות ומוצרי גברים");

    const blackFriday = getBlackFridayDate(year);
    addSale(blackFriday, "Black Friday · שיא מבצעי נובמבר", "יום מכירות חזק במיוחד גם בישראל");
    const cyberMonday = new Date(blackFriday);
    cyberMonday.setDate(cyberMonday.getDate() + 3);
    addSale(cyberMonday, "Cyber Monday · מבצעי אונליין", "יום המשך למבצעי Black Friday");

    addSale(new Date(year, 11, 12, 12), "מבצעי 12.12", "יום מבצעי אונליין נוסף");
    addSale(new Date(year, 11, 31, 12), "סוף שנה · מבצעי סיכום", "חלון מבצעים לסיום השנה האזרחית");
  }

  const scanStart = new Date(rangeStart);
  scanStart.setDate(scanStart.getDate() - 31);
  for (const date = new Date(scanStart); date <= rangeEnd; date.setDate(date.getDate() + 1)) {
    const { day, month } = getHebrewCalendarDateParts(date);
    if (month === "תשרי" && day === 1) {
      const campaignDate = new Date(date);
      campaignDate.setDate(campaignDate.getDate() - 14);
      addSale(campaignDate, "עונת חגי תשרי", "תחילת חלון מכירות לקראת ראש השנה והחגים");
    }
    if (month === "ניסן" && day === 15) {
      const campaignDate = new Date(date);
      campaignDate.setDate(campaignDate.getDate() - 14);
      addSale(campaignDate, "עונת מבצעי פסח", "תחילת חלון מכירות לקראת פסח");
    }
    if (month === "אב" && day === 15) {
      addSale(date, "ט״ו באב · קמפיין זוגיות ומתנות", "מועד מכירות ישראלי עונתי");
    }
    if (month === "כסלו" && day === 25) {
      addSale(date, "חנוכה · עונת מתנות", "חלון מכירות ישראלי לחנוכה");
    }
  }

  return sales;
}

function getNthWeekdayOfGregorianMonth(year, monthIndex, weekday, occurrence) {
  const date = new Date(year, monthIndex, 1, 12);
  const offset = (weekday - date.getDay() + 7) % 7;
  date.setDate(1 + offset + (occurrence - 1) * 7);
  return date;
}

function getBlackFridayDate(year) {
  const thanksgiving = getNthWeekdayOfGregorianMonth(year, 10, 4, 4);
  const blackFriday = new Date(thanksgiving);
  blackFriday.setDate(blackFriday.getDate() + 1);
  return blackFriday;
}

function getHebrewCalendarDateParts(date) {
  const parts = hebrewCalendarPartsFormatter.formatToParts(date);
  return {
    day: Number(parts.find((part) => part.type === "day")?.value || 0),
    month: parts.find((part) => part.type === "month")?.value || "",
    year: Number(parts.find((part) => part.type === "year")?.value || 0),
  };
}

function getObservedYomHaShoahDate(baseDate) {
  const observed = new Date(baseDate);
  if (observed.getDay() === 5) observed.setDate(observed.getDate() - 1);
  if (observed.getDay() === 0) observed.setDate(observed.getDate() + 1);
  return observed;
}

function getObservedFastDate(baseDate) {
  const observed = new Date(baseDate);
  if (observed.getDay() === 6) observed.setDate(observed.getDate() + 1);
  return observed;
}

function getObservedYomHaAtzmautDate(baseDate) {
  const observed = new Date(baseDate);
  if (observed.getDay() === 5) observed.setDate(observed.getDate() - 1);
  if (observed.getDay() === 6) observed.setDate(observed.getDate() - 2);
  if (observed.getDay() === 1) observed.setDate(observed.getDate() + 1);
  return observed;
}

function renderCalendarSelectedDayEvents(events, dateKey) {
  if (!dateKey) {
    dom.calendarEventsTitle.textContent = "פריטים ליום שנבחר";
    dom.calendarEventsCount.textContent = "בחר יום";
    const empty = document.createElement("p");
    empty.className = "calendar-empty";
    empty.textContent = "לחץ על יום בלוח כדי להציג תזכורות, פריטים פתוחים וחגים של אותו יום.";
    dom.calendarEventsList.replaceChildren(empty);
    return;
  }

  const date = getDateFromLocalKey(dateKey);
  const openEvents = events.filter((event) => event.type !== "holiday" && event.type !== "sales" && !event.completed);
  const holidays = events.filter((event) => event.type === "holiday");
  const salesEvents = events.filter((event) => event.type === "sales");
  const visibleEvents = [...holidays, ...salesEvents, ...openEvents];
  dom.calendarEventsTitle.textContent = `${formatReminderDate(dateKey)} · ${formatCalendarHebrewDate(date)}`;
  dom.calendarEventsCount.textContent = [
    holidays.length ? `${holidays.length.toLocaleString("he-IL")} חגים` : "",
    salesEvents.length ? `${salesEvents.length.toLocaleString("he-IL")} ימי מכירות` : "",
    openEvents.length ? `${openEvents.length.toLocaleString("he-IL")} פתוחים` : "",
  ].filter(Boolean).join(" · ") || "אין פריטים";

  if (!visibleEvents.length) {
    const empty = document.createElement("p");
    empty.className = "calendar-empty";
    empty.textContent = "אין תזכורות, פריטים פתוחים, חגים או ימי מכירות בתאריך זה.";
    dom.calendarEventsList.replaceChildren(empty);
    return;
  }

  dom.calendarEventsList.replaceChildren(...visibleEvents.map(renderCalendarEventRow));
}

function renderCalendarDay(date, events, options) {
  const day = document.createElement("button");
  day.type = "button";
  day.className = "calendar-day";
  day.classList.toggle("outside-month", !options.currentMonth);
  day.classList.toggle("today", options.today);
  day.classList.toggle("has-events", events.length > 0);
  day.classList.toggle("holiday", events.some((event) => event.type === "holiday"));
  day.classList.toggle("sales", events.some((event) => event.type === "sales"));
  day.classList.toggle("selected", options.selected);
  const dateKey = getLocalDateKey(date);
  day.dataset.calendarDate = dateKey;
  day.setAttribute("aria-pressed", String(Boolean(options.selected)));
  day.setAttribute("aria-label", `${formatReminderDate(dateKey)} · ${formatCalendarHebrewDate(date)}${events.length ? ` · ${events.length} אירועים` : ""}`);

  const heading = document.createElement("div");
  heading.className = "calendar-day-heading";
  heading.innerHTML = `
    <strong>${date.getDate().toLocaleString("he-IL")}</strong>
    <span>${escapeHtml(formatCalendarHebrewDay(date))}</span>
  `;

  const dayEvents = document.createElement("div");
  dayEvents.className = "calendar-day-events";
  events.slice(0, 2).forEach((event) => {
    const chip = document.createElement("div");
    chip.className = `calendar-event-chip ${event.type}${event.completed ? " completed" : ""}`;
    chip.textContent = event.type === "arrival"
      ? `מלאי · ${event.title.replace("חוזר למלאי · ", "")}`
      : event.type === "holiday"
        ? `חג · ${event.title}`
        : event.type === "sales"
          ? `מכירות · ${event.title}`
          : event.title;
    chip.title = `${event.title}${event.detail ? ` · ${event.detail}` : ""}`;
    dayEvents.append(chip);
  });
  if (events.length > 2) {
    const extra = document.createElement("span");
    extra.className = "calendar-more-events";
    extra.textContent = `+${events.length - 2}`;
    dayEvents.append(extra);
  }

  day.append(heading, dayEvents);
  return day;
}

function renderCalendarEventRow(event) {
  const row = document.createElement("article");
  row.className = `calendar-event-row ${event.type}${event.completed ? " completed" : ""}`;
  const date = getDateFromLocalKey(event.dateKey);
  row.innerHTML = `
    <div class="calendar-event-date">
      <strong>${escapeHtml(formatReminderDate(event.dateKey))}</strong>
      <span>${escapeHtml(formatCalendarHebrewDate(date))}</span>
    </div>
    <div class="calendar-event-copy">
      <span class="calendar-event-type">${event.type === "holiday" ? (event.detail || "חג ומועד") : event.type === "sales" ? "מועד מכירות" : event.type === "arrival" ? "חזרה למלאי" : event.completed ? "תזכורת שבוצעה" : "תזכורת"}</span>
      <strong>${escapeHtml(event.title)}</strong>
      ${event.detail ? `<small>${escapeHtml(event.detail)}</small>` : ""}
    </div>
  `;
  return row;
}

function formatCalendarHebrewDay(date) {
  return date.toLocaleDateString("he-IL-u-ca-hebrew", { day: "numeric", timeZone: "Asia/Jerusalem" });
}

function formatCalendarHebrewDate(date) {
  return date.toLocaleDateString("he-IL-u-ca-hebrew", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  });
}

async function requestAiOrderProposal(event) {
  event.preventDefault();
  const instruction = cleanString(dom.aiOrderInput.value);
  if (instruction.length < 4) {
    dom.aiOrderStatus.textContent = "כתוב את פרטי ההזמנה כדי שאוכל להכין הצעה.";
    dom.aiOrderInput.focus();
    return;
  }

  aiOrderProposal = null;
  dom.aiOrderGenerate.disabled = true;
  dom.aiOrderStatus.textContent = "מאתר לקוח, מוצרים ושריונים…";
  dom.aiOrderResult.innerHTML = `<div class="ai-order-loading"><span></span>מכין הצעה לבדיקה</div>`;

  try {
    const response = await fetch(AI_ORDER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ instruction }),
    });
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      lockApp("יש להתחבר מחדש כדי להשתמש בעוזר.");
      return;
    }
    if (!response.ok || !data?.proposal) {
      dom.aiOrderStatus.textContent = getAiOrderErrorMessage(data?.error, response.status);
      renderAiOrderEmptyState();
      return;
    }

    aiOrderProposal = data.proposal;
    dom.aiOrderStatus.textContent = data.proposal.ready
      ? "ההצעה מוכנה. בדוק אותה לפני שמירה או שליחה."
      : "ההצעה דורשת תיקון קטן לפני שאפשר ליצור הזמנה.";
    renderAiOrderProposal();
  } catch (error) {
    console.warn("AI order proposal failed", error);
    dom.aiOrderStatus.textContent = "לא הצלחתי להכין הצעה כרגע. נסה שוב.";
    renderAiOrderEmptyState();
  } finally {
    dom.aiOrderGenerate.disabled = false;
  }
}

function getAiOrderErrorMessage(error, status) {
  if (error === "ai_not_configured") return "חיבור ה‑AI עדיין לא הוגדר. יש להוסיף OPENAI_API_KEY ב‑Vercel.";
  if (error === "unauthorized") return "יש להתחבר מחדש כדי להשתמש בעוזר.";
  if (error === "cloud_storage_not_configured") return "האחסון בענן לא זמין כרגע.";
  if (error === "invalid_instruction") return "כתוב בקשה מפורטת יותר, למשל שם לקוח וכמויות.";
  if (error === "ai_provider_error") return "שירות ה‑AI לא זמין כרגע. נסה שוב בעוד רגע.";
  return status >= 500 ? "לא הצלחתי להכין הצעה כרגע. נסה שוב." : "לא הצלחתי להבין את הבקשה. נסח אותה מחדש.";
}

function renderAiOrderEmptyState() {
  dom.aiOrderResult.innerHTML = `
    <div class="ai-order-empty">
      <strong>הצעה תופיע כאן לפני כל פעולה.</strong>
      <span>לא תישמר הזמנה ולא תיפתח הודעה ב‑WhatsApp ללא לחיצה מפורשת שלך.</span>
    </div>
  `;
}

function renderAiOrderProposal() {
  if (!aiOrderProposal) {
    renderAiOrderEmptyState();
    return;
  }

  const proposal = aiOrderProposal;
  const items = Array.isArray(proposal.items) ? proposal.items : [];
  const unmatched = Array.isArray(proposal.unmatched) ? proposal.unmatched : [];
  const customerName = cleanString(proposal.customer?.name || proposal.customerQuery || "לא זוהה לקוח");
  const issueMessages = [cleanString(proposal.clarification), ...unmatched.map((item) => `לא נמצא: ${item.query}`)].filter(Boolean);
  const ready = Boolean(proposal.ready && proposal.customer?.id && items.length && !unmatched.length);
  const reservationUnits = items.reduce((sum, item) => sum + parseNonNegativeInteger(item.reservedQuantity), 0);
  const paidUnits = items.reduce((sum, item) => sum + parseNonNegativeInteger(item.paidQuantity), 0);

  const itemMarkup = items.length
    ? items
        .map((item) => {
          const reservedQuantity = parseNonNegativeInteger(item.reservedQuantity);
          const paidQuantity = parseNonNegativeInteger(item.paidQuantity);
          const reservationText = reservedQuantity
            ? `מהשריון: <strong>${reservedQuantity.toLocaleString("he-IL")} יח׳</strong> · נשאר בשריון: ${Math.max(0, Number(item.reservationRemainingAfter) || 0).toLocaleString("he-IL")}`
            : "מהשריון: 0 יח׳";
          const pricedText = paidQuantity
            ? `למחירון: <strong>${paidQuantity.toLocaleString("he-IL")} יח׳ × ${formatPrice(item.unitPrice)}</strong>`
            : "למחירון: 0 יח׳";
          return `
            <article class="ai-order-line">
              <div class="ai-order-line-main">
                <strong>${escapeHtml(item.sku || "ללא מק״ט")}</strong>
                <span>${escapeHtml(item.description || "מוצר")}</span>
              </div>
              <div class="ai-order-line-quantity">${parseNonNegativeInteger(item.quantity).toLocaleString("he-IL")} יח׳</div>
              <div class="ai-order-line-sources">
                <span class="ai-order-source reservation">${reservationText}</span>
                <span class="ai-order-source priced">${pricedText}</span>
              </div>
              <strong class="ai-order-line-total">${formatPrice(Number(item.pricedTotal) || 0)}</strong>
            </article>
          `;
        })
        .join("")
    : `<div class="ai-order-empty small"><strong>לא נמצאו עדיין מוצרים להצעה.</strong></div>`;

  const issueMarkup = issueMessages.length
    ? `<div class="ai-order-issues">${issueMessages.map((message) => `<span>${escapeHtml(message)}</span>`).join("")}</div>`
    : "";
  const actionMarkup = ready
    ? `
      <div class="ai-order-confirmation">
        <span>ההצעה לא נשמרה עדיין. בחר מה לעשות:</span>
        <div class="ai-order-confirmation-actions">
          <button class="secondary-button" type="button" data-ai-order-action="cart">טען לסל לבדיקה</button>
          <button class="file-button" type="button" data-ai-order-action="save">שמור הזמנה</button>
          <button class="whatsapp-button" type="button" data-ai-order-action="whatsapp">שמור ופתח WhatsApp</button>
        </div>
      </div>
    `
    : `<div class="ai-order-confirmation pending"><span>עדכן את הנוסח ושלח שוב כדי להשלים את הפריטים החסרים.</span></div>`;

  dom.aiOrderResult.innerHTML = `
    <section class="ai-order-proposal ${ready ? "ready" : "needs-review"}">
      <div class="ai-order-proposal-header">
        <div>
          <span>לקוח</span>
          <strong>${escapeHtml(customerName)}</strong>
        </div>
        <div class="ai-order-proposal-total">
          <span>לתשלום לפי מחירון</span>
          <strong>${formatPrice(Number(proposal.total) || 0)}</strong>
        </div>
      </div>
      <div class="ai-order-summary-chips">
        <span class="reservation">${reservationUnits.toLocaleString("he-IL")} יח׳ מהשריון</span>
        <span class="priced">${paidUnits.toLocaleString("he-IL")} יח׳ במחירון</span>
      </div>
      ${issueMarkup}
      <div class="ai-order-lines">${itemMarkup}</div>
      ${actionMarkup}
    </section>
  `;
}

function handleAiOrderAction(event) {
  const action = event.target.closest("[data-ai-order-action]")?.dataset.aiOrderAction;
  if (!action || !aiOrderProposal?.ready) return;

  if (action === "cart") {
    loadAiProposalIntoCart({ openCart: true });
    return;
  }

  const loaded = loadAiProposalIntoCart({ openCart: false });
  if (!loaded) return;
  const shouldOpenWhatsApp = action === "whatsapp";
  const order = saveOrder({
    status: shouldOpenWhatsApp
      ? "הזמנת העוזר נשמרה. הודעת ה‑WhatsApp נפתחה לשליחה."
      : "הזמנת העוזר נשמרה והשריונים עודכנו.",
  });
  if (!order || !shouldOpenWhatsApp) return;

  const url = createWhatsAppUrl(order.items, order);
  if (!url) {
    dom.status.textContent = "ההזמנה נשמרה. כדי לפתוח WhatsApp יש להגדיר מספר קבוע בסל.";
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function loadAiProposalIntoCart(options = { openCart: true }) {
  const proposal = aiOrderProposal;
  if (!proposal?.ready || !proposal.customer?.id || !Array.isArray(proposal.items) || !proposal.items.length) {
    dom.aiOrderStatus.textContent = "אין הצעה מלאה שאפשר לטעון לסל.";
    return false;
  }

  const customer = customers.find((item) => item.id === proposal.customer.id);
  if (!customer) {
    dom.aiOrderStatus.textContent = "הלקוח בהצעה כבר לא קיים. הכין הצעה חדשה.";
    return false;
  }
  if (cart.length && !window.confirm("להחליף את הפריטים שכבר נמצאים בסל בהצעת העוזר?")) return false;

  const proposalProducts = proposal.items.map((item) => ({
    item,
    product: products.find((product) => product.skuKey === item.skuKey),
  }));
  if (proposalProducts.some(({ product }) => !product)) {
    dom.aiOrderStatus.textContent = "אחד המוצרים כבר לא קיים במחירון. הכין הצעה חדשה.";
    return false;
  }

  cart = [];
  editingOrderId = "";
  editingDraftId = "";
  duplicatedOrderNeedsCustomer = false;
  orderReportTomorrow = false;
  orderReportToday = false;
  dom.saveAsDraft.checked = false;
  setOrderType("delivery", { render: false });
  applyCustomerToDraft(customer);
  customerConfirmedForCurrentCart = true;

  proposalProducts.forEach(({ item, product }) => {
    const reservedQuantity = parseNonNegativeInteger(item.reservedQuantity);
    const paidQuantity = parseNonNegativeInteger(item.paidQuantity);
    if (reservedQuantity > 0) {
      upsertCartLine(product, reservedQuantity, {
        fromReservation: true,
        unitPrice: 0,
        priceSource: "reservation",
      });
    }
    if (paidQuantity > 0) {
      upsertCartLine(product, paidQuantity, {
        fromReservation: false,
        unitPrice: Math.max(0, parsePrice(item.unitPrice) ?? product.price),
        priceSource: "list",
      });
    }
  });

  cart = orderCartLines(cart);
  saveCart();
  saveSettings();
  saveOrderReportTomorrow();
  render();
  dom.status.textContent = "הצעת העוזר נטענה לסל. בדוק אותה לפני שמירה.";
  if (options.openCart) setActiveTab("cart");
  return true;
}

function renderCollectionsPanel() {
  const customerValue = dom.collectionCustomer.value;
  dom.collectionCustomerOptions.replaceChildren(
    ...customers.map((customer) => {
      const option = document.createElement("option");
      option.value = customer.name;
      option.label = [customer.code, customer.phone].filter(Boolean).join(" · ");
      return option;
    }),
  );
  dom.collectionCustomer.value = customerValue;
  renderCollectionMonthFilterOptions();

  const stats = getCollectionStats(collections);
  dom.collectionsSummary.textContent = `${formatPrice(stats.openAmount)} פתוח`;
  dom.collectionsStats.replaceChildren(
    createCollectionStat("פתוח בגיול", formatPrice(stats.openAmount), "open"),
    createCollectionStat("שולם", formatPrice(stats.paidAmount), "paid"),
    createCollectionStat("לקוחות בגיול", stats.openCustomers.toLocaleString("he-IL"), "customers"),
    createCollectionStat("חשבוניות", stats.invoiceCount.toLocaleString("he-IL"), "customers"),
  );

  const query = normalizeSearch(dom.collectionSearch.value);
  const status = dom.collectionStatusFilter.value || "open";
  const monthFilter = dom.collectionMonthFilter.value || "";
  const colorFilter = dom.collectionColorFilter.value || "";
  const visible = collections
    .filter((item) => {
      const openAmount = getCollectionOpenAmount(item);
      const alertLevel = getCollectionPaymentAlert(item)?.level || "none";
      if (status === "open" && openAmount <= 0) return false;
      if (status === "paid" && openAmount > 0) return false;
      if (monthFilter && !hasCollectionOpenMonth(item, monthFilter)) return false;
      if (colorFilter && alertLevel !== colorFilter) return false;
      if (!query) return true;
      return normalizeSearch(
        `${item.customerName} ${item.amount} ${item.note} ${getCollectionSearchText(item)}`,
      ).includes(query);
    });

  if (!visible.length) {
    const message = collections.length
      ? "לא נמצאו חובות לפי הסינון הנוכחי."
      : "אין עדיין נתוני גיול. הוסף חוב ידנית או העלה דוח גיול.";
    dom.collectionsList.replaceChildren(emptyState(message));
    return;
  }

  dom.collectionsList.replaceChildren(...visible.map(renderCollectionRow));
}

function renderCollectionMonthFilterOptions() {
  const currentValue = dom.collectionMonthFilter.value || "";
  const months = getAvailableOpenCollectionMonths();
  dom.collectionMonthFilter.replaceChildren(
    createOption("", "כל החודשים"),
    ...months.map((monthKey) => createOption(monthKey, formatMonthKey(monthKey))),
  );
  dom.collectionMonthFilter.value = currentValue && months.includes(currentValue) ? currentValue : "";
}

function createCollectionStat(label, value, tone) {
  const item = document.createElement("div");
  item.className = `collection-stat ${tone}`;
  item.innerHTML = `
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
  `;
  return item;
}

function renderCollectionRow(item) {
  const row = document.createElement("article");
  row.className = "collection-row";
  const openAmount = getCollectionOpenAmount(item);
  const paidAmount = getCollectionPaidAmount(item);
  const collectionAlert = getCollectionPaymentAlert(item);
  row.classList.toggle("paid", openAmount <= 0);
  if (collectionAlert) row.classList.add(`payment-alert-${collectionAlert.level}`);

  const check = document.createElement("div");
  check.className = "collection-check";
  const statusButton = document.createElement("button");
  statusButton.type = "button";
  statusButton.className = "collection-status-button";
  statusButton.dataset.toggleCollectionPaid = item.id;
  statusButton.dataset.paidNext = String(openAmount > 0);
  statusButton.setAttribute("aria-label", `${openAmount <= 0 ? "פתח חוב" : "סגור חוב"}: ${item.customerName}`);
  statusButton.textContent = openAmount <= 0 ? "שולם" : "פתוח";
  check.append(statusButton);

  const body = document.createElement("div");
  body.className = "collection-body";
  const metadata = [
    item.sourceType === "aging-report" ? "דוח גיול" : "",
    item.invoices?.length ? `${item.invoices.length.toLocaleString("he-IL")} חשבוניות` : "",
    item.months?.length ? `${item.months.length.toLocaleString("he-IL")} חודשים` : "",
    item.note,
  ]
    .filter(Boolean)
    .join(" · ");
  body.innerHTML = `
    <strong>${escapeHtml(item.customerName || "ללא לקוח")}</strong>
    <span>${escapeHtml(metadata)}</span>
    ${collectionAlert ? `<small class="collection-payment-alert ${escapeHtml(collectionAlert.level)}">${escapeHtml(collectionAlert.label)}</small>` : ""}
  `;

  const values = document.createElement("div");
  values.className = "collection-values";
  values.innerHTML = `
    <b>${escapeHtml(formatPrice(openAmount))}</b>
    <span>בדוח ${escapeHtml(formatPrice(item.amount))}</span>
    ${paidAmount > 0 ? `<span>שולם ${escapeHtml(formatPrice(paidAmount))}</span>` : ""}
  `;

  const actions = document.createElement("div");
  actions.className = "collection-actions";
  const whatsapp = document.createElement("button");
  whatsapp.type = "button";
  whatsapp.className = "collection-whatsapp-button";
  whatsapp.dataset.sendCollectionWhatsapp = item.id;
  whatsapp.title = `שלח גיול בוואטסאפ עבור ${item.customerName}`;
  whatsapp.setAttribute("aria-label", `שלח גיול בוואטסאפ עבור ${item.customerName}`);
  whatsapp.innerHTML = `<span aria-hidden="true">WA</span>`;
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary-button";
  edit.dataset.editCollection = item.id;
  edit.textContent = "ערוך";
  actions.append(whatsapp, edit);

  row.append(check, body, values, actions);
  const details = renderCollectionDetails(item);
  if (details) row.append(details);
  return row;
}

function renderCollectionDetails(item) {
  if (!item.months?.length && !item.invoices?.length) return null;

  const details = document.createElement("details");
  details.className = "collection-details";
  details.dataset.collectionDetails = item.id;
  details.open = openCollectionDetails.has(item.id);
  const summary = document.createElement("summary");
  summary.textContent = "פירוט חודשים וחשבוניות";
  details.append(summary);

  if (item.months?.length) {
    const months = document.createElement("div");
    months.className = "collection-months";
    months.append(...item.months.map((month) => renderCollectionMonth(item, month)));
    details.append(months);
    return details;
  }

  if (item.invoices?.length) {
    const invoices = document.createElement("div");
    invoices.className = "collection-invoices";
    invoices.innerHTML = `
      <div class="collection-invoice-head">
        <span>חשבונית</span>
        <span>תאריך הפקה</span>
        <span>לתשלום</span>
        <span>סכום</span>
      </div>
    `;
    invoices.append(...item.invoices.map(renderCollectionInvoice));
    details.append(invoices);
  }

  return details;
}

function renderCollectionMonth(item, month) {
  const monthInvoices = getCollectionMonthInvoices(item, month.monthKey);
  const openAmount = getCollectionMonthOpenAmount(month);
  const paidAmount = getCollectionMonthPaidAmount(month);
  const isPaid = openAmount <= 0;
  const row = document.createElement("details");
  row.className = "collection-month-panel";
  row.classList.toggle("paid", isPaid);
  row.innerHTML = `
    <summary class="collection-month-summary">
      <span>
        <b>${escapeHtml(month.label || formatMonthKey(month.monthKey))}</b>
        <small>${Number(month.invoiceCount || monthInvoices.length).toLocaleString("he-IL")} חשבוניות · ${escapeHtml(formatCollectionDueDates(monthInvoices))}</small>
      </span>
      <span class="collection-month-values">
        <strong>${escapeHtml(formatPrice(openAmount))}</strong>
        ${paidAmount > 0 ? `<small>שולם ${escapeHtml(formatPrice(paidAmount))}</small>` : ""}
      </span>
      <button
        type="button"
        class="collection-status-button month-status"
        data-toggle-collection-month="${escapeHtml(item.id)}"
        data-month-key="${escapeHtml(month.monthKey)}"
        data-paid-next="${isPaid ? "false" : "true"}"
      >${isPaid ? "שולם" : paidAmount > 0 ? "חלקי" : "פתוח"}</button>
    </summary>
    ${renderCollectionInvoicesTable(monthInvoices)}
  `;
  return row;
}

function renderCollectionInvoicesTable(invoices) {
  if (!invoices.length) return `<div class="collection-invoices">${escapeHtml("אין חשבוניות לחודש הזה.")}</div>`;
  return `
    <div class="collection-invoices month-invoices">
      <div class="collection-invoice-head">
        <span>חשבונית</span>
        <span>תאריך הפקה</span>
        <span>לתשלום</span>
        <span>סכום</span>
      </div>
      ${invoices.map((invoice) => renderCollectionInvoiceHtml(invoice)).join("")}
    </div>
  `;
}

function getCollectionMonthInvoices(item, monthKey) {
  return (item.invoices || []).filter((invoice) => getInvoiceMonthKey(invoice.invoiceDate) === monthKey).sort(compareCollectionInvoices);
}

function formatCollectionDueDates(invoices) {
  const dueDates = [
    ...new Set(
      invoices
        .map((invoice) => normalizeDateInput(invoice.dueDate))
        .filter(Boolean)
        .sort(),
    ),
  ];
  if (!dueDates.length) return "ללא תאריך תשלום";
  const visible = dueDates.slice(0, 4).map(formatReminderDate).join(", ");
  return dueDates.length > 4 ? `תשלומים: ${visible} ועוד ${dueDates.length - 4}` : `תשלומים: ${visible}`;
}

function renderCollectionInvoice(invoice) {
  const row = document.createElement("div");
  row.className = "collection-invoice-row";
  row.innerHTML = renderCollectionInvoiceHtml(invoice, { innerOnly: true });
  return row;
}

function renderCollectionInvoiceHtml(invoice, options = {}) {
  const inner = `
    <span>
      <b>${escapeHtml(invoice.invoiceNumber || "")}</b>
      ${invoice.details ? `<small>${escapeHtml(invoice.details)}</small>` : ""}
    </span>
    <span>${escapeHtml(formatReminderDate(invoice.invoiceDate))}</span>
    <span>${escapeHtml(formatReminderDate(invoice.dueDate))}</span>
    <strong>${escapeHtml(formatPrice(invoice.amount))}</strong>
  `;
  return options.innerOnly ? inner : `<div class="collection-invoice-row">${inner}</div>`;
}

function saveCollectionFromForm(event) {
  event.preventDefault();
  const id = cleanString(dom.collectionId.value);
  const amount = parsePrice(dom.collectionAmount.value);
  const customer = findCustomerByLooseName(dom.collectionCustomer.value);
  const customerName = customer?.name || cleanString(dom.collectionCustomer.value);
  if (!customerName) {
    dom.status.textContent = "צריך לבחור או להקליד לקוח לגיול.";
    dom.collectionCustomer.focus();
    return;
  }
  if (amount === null || amount <= 0) {
    dom.status.textContent = "צריך להזין סכום חוב גדול מאפס.";
    dom.collectionAmount.focus();
    return;
  }

  const existing = collections.find((item) => item.id === id);
  const now = new Date().toISOString();
  const reminderDueDate = normalizeDateInput(dom.collectionDueDate.value);
  const collection = {
    id: existing?.id || `collection-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    customerId: customer?.id || existing?.customerId || "",
    customerName,
    amount: roundMoney(amount),
    paidAmount: existing ? Math.min(roundMoney(amount), getCollectionEntryPaidAmount(existing)) : 0,
    accountNumber: existing?.accountNumber || "",
    invoices: existing?.invoices || [],
    months: existing?.months || [],
    dueDate: "",
    note: cleanString(dom.collectionNote.value),
    paid: Boolean(existing?.paid),
    paidAt: existing?.paidAt || "",
    sourceType: existing?.sourceType || "",
    sourceName: existing?.sourceName || "",
    importedAt: existing?.importedAt || "",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  collections = existing
    ? collections.map((item) => (item.id === collection.id ? collection : item))
    : [...collections, collection];
  const reminderChanged = syncCollectionReminder(collection, reminderDueDate);
  if (reminderChanged) saveReminders({ sync: false });
  saveCollections();
  resetCollectionForm();
  renderCollectionsPanel();
  renderRemindersPanel();
  renderDashboard();
  dom.status.textContent = reminderDueDate
    ? `${existing ? "פרטי הגיול עודכנו" : "חוב חדש נוסף לגיול"} ונוצרה תזכורת בלשונית תזכורות.`
    : existing
      ? "פרטי הגיול עודכנו."
      : "חוב חדש נוסף לגיול.";
}

function saveCollectionPaymentFromForm(event) {
  event.preventDefault();
  const customerName = cleanString(dom.collectionPaymentCustomer.value);
  const amount = parsePrice(dom.collectionPaymentAmount.value);
  if (!customerName) {
    dom.collectionPaymentStatus.textContent = "צריך לבחור או להקליד לקוח.";
    dom.collectionPaymentCustomer.focus();
    return;
  }
  if (amount === null || amount <= 0) {
    dom.collectionPaymentStatus.textContent = "צריך להזין סכום תשלום גדול מאפס.";
    dom.collectionPaymentAmount.focus();
    return;
  }

  const customer = findCustomerByLooseName(customerName);
  const result = applyCollectionPayment(customer, customerName, amount);
  if (result.applied <= 0) {
    const message = "לא נמצא ללקוח חוב פתוח לקיזוז בגיול.";
    dom.collectionPaymentStatus.textContent = message;
    dom.status.textContent = message;
    return;
  }

  saveCollections();
  renderCollectionsPanel();
  renderDashboard();
  dom.collectionPaymentAmount.value = "";
  const details = [`${formatPrice(result.applied)} קוזזו מ־${result.monthsUpdated.toLocaleString("he-IL")} חודשים`];
  if (result.unapplied > 0) details.push(`${formatPrice(result.unapplied)} לא נקלטו כי אין יתרת חוב פתוחה`);
  const message = `${details.join(" · ")}.`;
  dom.collectionPaymentStatus.textContent = message;
  dom.status.textContent = message;
}

function applyCollectionPayment(customer, customerName, amount) {
  const normalizedName = normalizeSearch(customerName);
  const matchesCustomer = (collection) =>
    (customer?.id && collection.customerId === customer.id) ||
    normalizeSearch(collection.customerName) === normalizeSearch(customer?.name || customerName) ||
    normalizeSearch(collection.customerName) === normalizedName;
  const targets = [];

  collections.forEach((collection, collectionIndex) => {
    if (!matchesCustomer(collection) || getCollectionOpenAmount(collection) <= 0) return;
    if (collection.months?.length) {
      collection.months.forEach((month, monthIndex) => {
        if (getCollectionMonthOpenAmount(month) <= 0) return;
        targets.push({
          type: "month",
          collectionIndex,
          monthIndex,
          orderKey: `${month.monthKey || "9999-99"}|${collection.createdAt || ""}|${collection.id}`,
        });
      });
      return;
    }
    targets.push({
      type: "collection",
      collectionIndex,
      orderKey: `${getInvoiceMonthKey(collection.invoices?.[0]?.invoiceDate) || collection.createdAt?.slice(0, 7) || "9999-99"}|${collection.createdAt || ""}|${collection.id}`,
    });
  });

  targets.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  if (!targets.length) return { applied: 0, unapplied: amount, monthsUpdated: 0 };

  const now = new Date().toISOString();
  const nextCollections = collections.map((collection) => ({
    ...collection,
    months: collection.months?.map((month) => ({ ...month })) || [],
  }));
  let remaining = roundMoney(amount);
  let applied = 0;
  let monthsUpdated = 0;

  targets.forEach((target) => {
    if (remaining <= 0) return;
    const collection = nextCollections[target.collectionIndex];
    if (!collection) return;

    if (target.type === "month") {
      const month = collection.months[target.monthIndex];
      const openAmount = getCollectionMonthOpenAmount(month);
      const payment = Math.min(remaining, openAmount);
      if (payment <= 0) return;
      month.paidAmount = roundMoney(getCollectionMonthPaidAmount(month) + payment);
      month.paid = getCollectionMonthOpenAmount(month) <= 0;
      month.paidAt = month.paid ? now : "";
      remaining = roundMoney(remaining - payment);
      applied = roundMoney(applied + payment);
      monthsUpdated += 1;
      collection.paid = collection.months.every((entry) => getCollectionMonthOpenAmount(entry) <= 0);
      collection.paidAt = collection.paid ? collection.paidAt || now : "";
      collection.updatedAt = now;
      return;
    }

    const openAmount = getCollectionOpenAmount(collection);
    const payment = Math.min(remaining, openAmount);
    if (payment <= 0) return;
    collection.paidAmount = roundMoney(getCollectionEntryPaidAmount(collection) + payment);
    collection.paid = getCollectionOpenAmount(collection) <= 0;
    collection.paidAt = collection.paid ? collection.paidAt || now : "";
    collection.updatedAt = now;
    remaining = roundMoney(remaining - payment);
    applied = roundMoney(applied + payment);
    monthsUpdated += 1;
  });

  collections = nextCollections;
  return { applied, unapplied: Math.max(0, remaining), monthsUpdated };
}

async function handleCollectionReportUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  if (!file.type.includes("pdf") && !/\.pdf$/i.test(file.name)) {
    dom.collectionImportStatus.textContent = "אפשר להעלות כאן רק דוח PDF.";
    event.target.value = "";
    return;
  }

  if (file.size > 14 * 1024 * 1024) {
    dom.collectionImportStatus.textContent = "הקובץ גדול מדי להעלאה. נסה דוח PDF קטן יותר.";
    event.target.value = "";
    return;
  }

  dom.collectionImportStatus.textContent = `קורא ובודק את ${file.name} פעמיים...`;
  dom.status.textContent = "מייבא דוח גיול...";

  try {
    const data = await readFileAsBase64(file);
    const response = await fetch(COLLECTION_IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type || "application/pdf",
        data,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      lockApp("יש להתחבר מחדש כדי לייבא דוח גיול.");
      return;
    }
    if (!response.ok) {
      throw new Error(getCollectionImportErrorMessage(result.error));
    }

    const imported = applyCollectionReportImport(result.items || [], file.name);
    saveCollections();
    renderCollectionsPanel();
    renderDashboard();
    const skipped = Math.max(0, Number(result.skippedNonPositive) || 0);
    const skippedText = skipped ? ` ${skipped.toLocaleString("he-IL")} יתרות שליליות/אפס לא נכנסו כחוב.` : "";
    const verifiedText = Number(result.verifiedPasses) >= 2 ? " הדוח נבדק פעמיים לפני העדכון." : "";
    dom.collectionImportStatus.textContent = `יובאו ${imported.toLocaleString("he-IL")} לקוחות מדוח הגיול.${verifiedText}${skippedText}`;
    dom.status.textContent = `דוח הגיול עודכן: ${imported.toLocaleString("he-IL")} לקוחות.${verifiedText}${skippedText}`;
  } catch (error) {
    console.error("Collection report import failed", error);
    const message = error.message || "לא הצלחתי לייבא את דוח הגיול.";
    dom.collectionImportStatus.textContent = message;
    dom.status.textContent = message;
  } finally {
    event.target.value = "";
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "").replace(/^data:.*?;base64,/, "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("file_read_failed")));
    reader.readAsDataURL(file);
  });
}

function applyCollectionReportImport(items, fileName) {
  const now = new Date().toISOString();
  const importedItems = normalizeImportedCollectionItems(items);
  if (!importedItems.length) throw new Error("לא נמצאו חובות בדוח הגיול.");

  const previousByCustomer = new Map(
    collections
      .filter((item) => item.sourceType === "aging-report")
      .map((item) => [normalizeCustomerIdentity(item.customerName), item]),
  );

  const reportCollections = importedItems.map((item, index) => {
    const customer = findCustomerByLooseName(item.customerName);
    const customerName = customer?.name || item.customerName;
    const previous = previousByCustomer.get(normalizeCustomerIdentity(customerName));
    const months = buildCollectionMonths(item.invoices, previous?.months || []);
    const paidAmount = months.length
      ? roundMoney(months.reduce((sum, month) => sum + getCollectionMonthPaidAmount(month), 0))
      : getCollectionEntryPaidAmount(previous || { amount: item.amount });
    const paid = months.length ? months.every((month) => getCollectionMonthOpenAmount(month) <= 0) : paidAmount >= item.amount;

    return {
      id: previous?.id || `collection-aging-${Date.now()}-${index}`,
      customerId: customer?.id || previous?.customerId || "",
      customerName,
      amount: item.amount,
      paidAmount,
      accountNumber: item.accountNumber || previous?.accountNumber || "",
      invoices: item.invoices,
      months,
      dueDate: "",
      note: previous?.note || "",
      paid,
      paidAt: paid ? previous?.paidAt || now : "",
      sourceType: "aging-report",
      sourceName: fileName,
      importedAt: now,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
  });

  collections = [
    ...collections.filter((item) => item.sourceType !== "aging-report"),
    ...reportCollections,
  ];

  return reportCollections.length;
}

function normalizeImportedCollectionItems(items) {
  const byCustomer = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    const customerName = cleanString(item?.customerName);
    const amount = parsePrice(item?.amount);
    const key = normalizeCustomerIdentity(customerName);
    if (!customerName || !key || amount === null) return;
    byCustomer.set(key, {
      customerName,
      accountNumber: cleanString(item?.accountNumber),
      amount: roundMoney(amount),
      invoices: normalizeCollectionInvoices(item?.invoices),
    });
  });

  return [...byCustomer.values()];
}

function normalizeCollectionInvoices(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((invoice, index) => {
      if (!invoice || typeof invoice !== "object") return null;
      const amount = parsePrice(invoice.amount);
      if (amount === null) return null;
      const invoiceDate = normalizeDateInput(invoice.invoiceDate);
      const invoiceNumber = cleanString(invoice.invoiceNumber);
      const id = cleanString(invoice.id) || `${invoiceNumber || "invoice"}-${invoiceDate || index}-${amount}`;
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        invoiceNumber,
        invoiceDate,
        dueDate: normalizeDateInput(invoice.dueDate),
        delayDays: Math.max(0, Math.floor(Number(invoice.delayDays) || 0)),
        transactionType: cleanString(invoice.transactionType),
        details: cleanString(invoice.details),
        amount: roundMoney(amount),
        cumulative: parsePrice(invoice.cumulative),
      };
    })
    .filter(Boolean)
    .sort(compareCollectionInvoices);
}

function buildCollectionMonths(invoices, previousMonths = []) {
  const stateByMonth = new Map(
    (Array.isArray(previousMonths) ? previousMonths : [])
      .map((month) => normalizeCollectionMonthState(month))
      .filter(Boolean)
      .map((month) => [month.monthKey, month]),
  );
  const byMonth = new Map();

  invoices.forEach((invoice) => {
    const monthKey = getInvoiceMonthKey(invoice.invoiceDate);
    if (!monthKey) return;
    const current = byMonth.get(monthKey) || { monthKey, amount: 0, invoiceCount: 0, dueDates: new Set() };
    current.amount = roundMoney(current.amount + invoice.amount);
    current.invoiceCount += 1;
    if (invoice.dueDate) current.dueDates.add(invoice.dueDate);
    byMonth.set(monthKey, current);
  });

  return [...byMonth.values()]
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((month) => {
      const previous = stateByMonth.get(month.monthKey);
      const paidAmount = roundMoney(
        Math.min(
          month.amount,
          Math.max(0, previous ? getCollectionMonthPaidAmount(previous) : 0),
        ),
      );
      return {
        monthKey: month.monthKey,
        label: formatMonthKey(month.monthKey),
        amount: roundMoney(month.amount),
        paidAmount,
        invoiceCount: month.invoiceCount,
        dueDates: [...month.dueDates].sort(),
        paid: paidAmount >= roundMoney(month.amount),
        paidAt: paidAmount >= roundMoney(month.amount) ? previous?.paidAt || "" : "",
      };
    });
}

function normalizeCollectionMonthState(month) {
  if (!month || typeof month !== "object") return null;
  const monthKey = cleanString(month.monthKey);
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return null;
  const amount = roundMoney(parsePrice(month.amount) || 0);
  const paidAmount = month.paid
    ? amount
    : roundMoney(Math.min(amount, Math.max(0, parsePrice(month.paidAmount) || 0)));
  return {
    monthKey,
    label: cleanString(month.label) || formatMonthKey(monthKey),
    amount,
    paidAmount,
    invoiceCount: Math.max(0, Math.floor(Number(month.invoiceCount) || 0)),
    dueDates: Array.isArray(month.dueDates) ? month.dueDates.map(normalizeDateInput).filter(Boolean).sort() : [],
    paid: paidAmount >= amount,
    paidAt: paidAmount >= amount ? month.paidAt || "" : "",
  };
}

function compareCollectionInvoices(a, b) {
  const dateCompare = cleanString(a.invoiceDate).localeCompare(cleanString(b.invoiceDate));
  if (dateCompare) return dateCompare;
  return cleanString(a.invoiceNumber).localeCompare(cleanString(b.invoiceNumber));
}

function getInvoiceMonthKey(value) {
  const date = normalizeDateInput(value);
  return date ? date.slice(0, 7) : "";
}

function formatMonthKey(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(cleanString(monthKey))) return cleanString(monthKey);
  const [year, month] = monthKey.split("-");
  return monthFormatter.format(new Date(Number(year), Number(month) - 1, 1));
}

function getCollectionImportErrorMessage(errorCode) {
  if (errorCode === "unauthorized") return "יש להתחבר מחדש כדי לייבא דוח גיול.";
  if (errorCode === "invalid_file") return "הקובץ לא נראה כמו PDF תקין.";
  if (errorCode === "file_too_large") return "הקובץ גדול מדי להעלאה.";
  if (errorCode === "no_rows_detected") return "לא זוהו שורות סיכום בדוח. ודא שזה דוח גיול בפורמט הקבוע.";
  if (errorCode === "verification_failed") return "הייבוא נעצר כי שתי בדיקות הדוח לא יצאו זהות. לא עודכנו נתוני כסף.";
  return "לא הצלחתי לייבא את דוח הגיול.";
}

function getCollectionReminderId(collectionId) {
  return `collection-reminder-${collectionId}`;
}

function sendCollectionToWhatsApp(collectionId) {
  const collection = collections.find((item) => item.id === collectionId);
  if (!collection) return;

  const url = createCollectionWhatsAppUrl(collection);
  if (!url) {
    const message = "צריך להוסיף טלפון ללקוח או להגדיר מספר וואטסאפ קבוע במערכת.";
    dom.status.textContent = message;
    window.alert(message);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
  dom.status.textContent = `גיול של ${collection.customerName} נפתח לשליחה בוואטסאפ.`;
}

function createCollectionWhatsAppUrl(collection) {
  const customer = getCollectionCustomer(collection);
  const phone = normalizePhone(customer?.phone) || normalizePhone(settings.whatsappNumber);
  if (!phone) return "";
  return `https://wa.me/${phone}?text=${encodeURIComponent(createCollectionMessage(collection))}`;
}

function getCollectionCustomer(collection) {
  return (
    customers.find((customer) => customer.id && customer.id === collection.customerId) ||
    findCustomerByLooseName(collection.customerName) ||
    null
  );
}

function createCollectionMessage(collection) {
  const openAmount = getCollectionOpenAmount(collection);
  const lines = [
    `גיול - ${collection.customerName || "לקוח"}`,
    `סה״כ פתוח: ${formatPlainPrice(openAmount)} ש״ח`,
    "",
  ];

  const openMonths = getCollectionOpenMonths(collection);
  if (openMonths.length) {
    lines.push("פירוט חודשים פתוחים:");
    openMonths.forEach((month) => lines.push(formatCollectionMessageMonth(collection, month)));
  } else if (openAmount > 0) {
    lines.push(`חוב פתוח: ${formatPlainPrice(openAmount)} ש״ח`);
  } else {
    lines.push("אין חוב פתוח כרגע.");
  }

  if (collection.note) {
    lines.push("");
    lines.push(`הערה: ${collection.note}`);
  }

  return lines.join("\n");
}

function getCollectionOpenMonths(collection) {
  return (collection.months || [])
    .filter((month) => getCollectionMonthOpenAmount(month) > 0)
    .sort((a, b) => cleanString(a.monthKey).localeCompare(cleanString(b.monthKey)));
}

function getAvailableOpenCollectionMonths() {
  const monthKeys = new Set();
  collections.forEach((collection) => {
    getCollectionOpenMonths(collection).forEach((month) => {
      if (month.monthKey) monthKeys.add(month.monthKey);
    });
  });
  return [...monthKeys].sort();
}

function hasCollectionOpenMonth(collection, monthKey) {
  return getCollectionOpenMonths(collection).some((month) => month.monthKey === monthKey);
}

function formatCollectionMessageMonth(collection, month) {
  const monthInvoices = getCollectionMonthInvoices(collection, month.monthKey);
  const invoiceCount = Number(month.invoiceCount || monthInvoices.length) || 0;
  const invoiceText = invoiceCount ? ` · ${invoiceCount.toLocaleString("he-IL")} חשבוניות` : "";
  const dueText = formatCollectionMonthDueText(month, monthInvoices);
  return `- ${month.label || formatMonthKey(month.monthKey)}: ${formatPlainPrice(getCollectionMonthOpenAmount(month))} ש״ח${invoiceText}${dueText}`;
}

function formatCollectionMonthDueText(month, invoices) {
  const dueDates = [
    ...new Set([
      ...(Array.isArray(month.dueDates) ? month.dueDates : []),
      ...(Array.isArray(invoices) ? invoices.map((invoice) => invoice.dueDate) : []),
    ]
      .map(normalizeDateInput)
      .filter(Boolean)),
  ].sort();
  if (!dueDates.length) return "";
  const visible = dueDates.slice(0, 2).map(formatReminderDate).join(", ");
  return dueDates.length > 2 ? ` · לתשלום: ${visible} ועוד ${dueDates.length - 2}` : ` · לתשלום: ${visible}`;
}

function findCollectionReminder(collectionId) {
  const reminderId = getCollectionReminderId(collectionId);
  return (
    reminders.find((reminder) => reminder.id === reminderId) ||
    reminders.find((reminder) => reminder.sourceType === "collection" && reminder.sourceId === collectionId) ||
    null
  );
}

function syncCollectionReminder(collection, dueDate) {
  const reminderId = getCollectionReminderId(collection.id);
  const existing = findCollectionReminder(collection.id);

  if (!dueDate) {
    if (!existing) return false;
    reminders = reminders.filter((reminder) => reminder.id !== existing.id);
    return true;
  }

  const now = new Date().toISOString();
  const customer = customers.find((item) => item.id === collection.customerId) || findCustomerByLooseName(collection.customerName);
  const reminder = {
    id: existing?.id || reminderId,
    title: `תזכורת גיול - ${collection.customerName}`,
    dueDate,
    customerId: customer?.id || collection.customerId || "",
    customerName: customer?.name || collection.customerName || "",
    completed: Boolean(existing?.completed),
    completedAt: existing?.completedAt || "",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    sourceType: "collection",
    sourceId: collection.id,
  };
  reminders = [reminder, ...reminders.filter((item) => item.id !== reminder.id)];
  return true;
}

function migrateCollectionDueDatesToReminders() {
  let changed = false;
  collections = collections.map((collection) => {
    const dueDate = normalizeDateInput(collection.dueDate);
    if (!dueDate) return collection;
    if (syncCollectionReminder(collection, dueDate)) changed = true;
    return {
      ...collection,
      dueDate: "",
      updatedAt: new Date().toISOString(),
    };
  });
  return changed;
}

function editCollection(collectionId) {
  const item = collections.find((collection) => collection.id === collectionId);
  if (!item) return;
  dom.collectionId.value = item.id;
  dom.collectionCustomer.value = item.customerName || "";
  dom.collectionAmount.value = String(item.amount || "");
  dom.collectionDueDate.value = findCollectionReminder(item.id)?.dueDate || item.dueDate || "";
  dom.collectionNote.value = item.note || "";
  dom.collectionCustomer.focus();
}

function resetCollectionForm() {
  dom.collectionId.value = "";
  dom.collectionCustomer.value = "";
  dom.collectionAmount.value = "";
  dom.collectionDueDate.value = "";
  dom.collectionNote.value = "";
}

function setCollectionPaid(collectionId, paid) {
  const now = new Date().toISOString();
  collections = collections.map((item) =>
    item.id === collectionId
      ? {
          ...item,
          months: item.months?.length
            ? item.months.map((month) => ({
                ...month,
                paid: Boolean(paid),
                paidAmount: paid ? Math.max(0, roundMoney(month.amount)) : 0,
                paidAt: paid ? now : "",
              }))
            : item.months,
          paidAmount: paid ? Math.max(0, roundMoney(item.amount)) : 0,
          paid: Boolean(paid),
          paidAt: paid ? now : "",
          updatedAt: now,
        }
      : item,
  );
  saveCollections();
  renderCollectionsPanel();
  renderDashboard();
}

function setCollectionMonthPaid(collectionId, monthKey, paid) {
  const now = new Date().toISOString();
  openCollectionDetails.add(collectionId);
  collections = collections.map((item) => {
    if (item.id !== collectionId) return item;
    const months = (item.months || []).map((month) =>
      month.monthKey === monthKey
        ? {
            ...month,
            paid: Boolean(paid),
            paidAmount: paid ? Math.max(0, roundMoney(month.amount)) : 0,
            paidAt: paid ? now : "",
          }
        : month,
    );
    const isPaid = months.length ? months.every((month) => getCollectionMonthOpenAmount(month) <= 0) : Boolean(item.paid);
    return {
      ...item,
      months,
      paid: isPaid,
      paidAt: isPaid ? item.paidAt || now : "",
      updatedAt: now,
    };
  });
  saveCollections();
  renderCollectionsPanel();
  renderDashboard();
  dom.status.textContent = paid ? "החודש סומן כשולם ונשמר בגיול." : "החודש סומן כפתוח ונשמר בגיול.";
}

function getCollectionStats(items) {
  const openItems = items.filter((item) => getCollectionOpenAmount(item) > 0);
  return {
    openAmount: roundMoney(items.reduce((sum, item) => sum + getCollectionOpenAmount(item), 0)),
    paidAmount: roundMoney(items.reduce((sum, item) => sum + getCollectionPaidAmount(item), 0)),
    openCustomers: new Set(openItems.map((item) => item.customerId || normalizeSearch(item.customerName))).size,
    invoiceCount: items.reduce((sum, item) => sum + (Array.isArray(item.invoices) ? item.invoices.length : 0), 0),
  };
}

function getCollectionOpenAmount(item) {
  if (item.months?.length) {
    return roundMoney(item.months.reduce((sum, month) => sum + getCollectionMonthOpenAmount(month), 0));
  }
  return roundMoney(Math.max(0, (parsePrice(item.amount) ?? 0) - getCollectionEntryPaidAmount(item)));
}

function getCollectionPaidAmount(item) {
  if (item.months?.length) {
    return roundMoney(item.months.reduce((sum, month) => sum + getCollectionMonthPaidAmount(month), 0));
  }
  return getCollectionEntryPaidAmount(item);
}

function getCollectionMonthPaidAmount(month) {
  const amount = Math.max(0, parsePrice(month?.amount) ?? 0);
  if (month?.paid) return amount;
  return roundMoney(Math.min(amount, Math.max(0, parsePrice(month?.paidAmount) ?? 0)));
}

function getCollectionMonthOpenAmount(month) {
  return roundMoney(Math.max(0, (parsePrice(month?.amount) ?? 0) - getCollectionMonthPaidAmount(month)));
}

function getCollectionEntryPaidAmount(item) {
  const amount = Math.max(0, parsePrice(item?.amount) ?? 0);
  if (item?.paid) return amount;
  return roundMoney(Math.min(amount, Math.max(0, parsePrice(item?.paidAmount) ?? 0)));
}

function getCollectionPaymentAlert(item, reference = new Date()) {
  const alerts = getCollectionMonthPaymentAlerts(item, reference);
  if (!alerts.length) return null;
  const priority = { red: 3, orange: 2, green: 1 };
  return alerts.sort(
    (a, b) =>
      priority[b.level] - priority[a.level] ||
      cleanString(a.dueDate).localeCompare(cleanString(b.dueDate)) ||
      cleanString(a.monthKey).localeCompare(cleanString(b.monthKey)),
  )[0];
}

function getCollectionMonthPaymentAlerts(item, reference = new Date()) {
  if (getCollectionOpenAmount(item) <= 0) return [];
  const todayKey = getLocalDateKey(reference);
  return getCollectionOpenMonths(item)
    .map((month) => {
      const dueDate = getCollectionMonthPrimaryDueDate(item, month);
      if (!dueDate) return null;
      const oneMonthBefore = shiftLocalDateKeyByMonths(dueDate, -1);
      const oneMonthAfter = shiftLocalDateKeyByMonths(dueDate, 1);
      const twoMonthsAfter = shiftLocalDateKeyByMonths(dueDate, 2);

      if (todayKey >= twoMonthsAfter) {
        return {
          level: "red",
          monthKey: month.monthKey,
          dueDate,
          label: `${month.label || formatMonthKey(month.monthKey)} פתוח - עברו חודשיים מתאריך הגבייה ${formatReminderDate(dueDate)}`,
        };
      }

      if (todayKey >= oneMonthAfter) {
        return {
          level: "orange",
          monthKey: month.monthKey,
          dueDate,
          label: `${month.label || formatMonthKey(month.monthKey)} פתוח - עבר חודש מתאריך הגבייה ${formatReminderDate(dueDate)}`,
        };
      }

      if (todayKey >= oneMonthBefore && todayKey < dueDate) {
        return {
          level: "green",
          monthKey: month.monthKey,
          dueDate,
          label: `${month.label || formatMonthKey(month.monthKey)} לתשלום בקרוב - ${formatReminderDate(dueDate)}`,
        };
      }

      return null;
    })
    .filter(Boolean);
}

function getCollectionMonthPrimaryDueDate(item, month) {
  const monthInvoices = getCollectionMonthInvoices(item, month.monthKey);
  const dueDates = [
    ...new Set([
      ...(Array.isArray(month.dueDates) ? month.dueDates : []),
      ...monthInvoices.map((invoice) => invoice.dueDate),
    ]
      .map(normalizeDateInput)
      .filter(Boolean)),
  ].sort();
  return dueDates[0] || "";
}

function shiftLocalDateKeyByMonths(value, offset) {
  const dateKey = normalizeDateInput(value);
  if (!dateKey) return "";
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetMonthIndex = month - 1 + offset;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonthIndex + 1, 0).getDate();
  return getLocalDateKey(new Date(targetYear, normalizedMonthIndex, Math.min(day, lastDay), 12));
}

function getCollectionSearchText(item) {
  return [
    ...(item.months || []).map((month) => `${month.label} ${month.monthKey} ${month.amount}`),
    ...(item.invoices || []).map(
      (invoice) =>
        `${invoice.invoiceNumber} ${invoice.invoiceDate} ${invoice.dueDate} ${invoice.details} ${invoice.amount} ${invoice.cumulative}`,
    ),
  ].join(" ");
}

function isCollectionDue(item, reference = new Date()) {
  const dueDate = normalizeDateInput(item?.dueDate);
  return Boolean(getCollectionOpenAmount(item) > 0 && dueDate && dueDate <= getLocalDateKey(reference));
}

function compareCollections(a, b) {
  if (a.paid !== b.paid) return Number(a.paid) - Number(b.paid);
  const aDue = normalizeDateInput(a.dueDate);
  const bDue = normalizeDateInput(b.dueDate);
  if (aDue && bDue && aDue !== bDue) return aDue.localeCompare(bDue);
  if (aDue !== bDue) return aDue ? -1 : 1;
  return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
}

function renderDashboard() {
  const now = new Date();
  const todayOrders = orders.filter((order) => isSameDay(getOrderReportDate(order), now));
  const todayOpenOrders = todayOrders.filter((order) => !isOrderCompleted(order));
  const todayRevenue = todayOrders.reduce((sum, order) => sum + getPaidSalesTotal(order.items), 0);
  const monthOrders = orders.filter((order) => isSameMonth(getOrderReportDate(order), now));
  const monthRevenue = monthOrders.reduce((sum, order) => sum + getPaidSalesTotal(order.items), 0);
  const yearOrders = orders.filter((order) => isSameYear(getOrderReportDate(order), now));
  const yearRevenue = yearOrders.reduce((sum, order) => sum + getPaidSalesTotal(order.items), 0);
  const monthUnits = monthOrders.reduce(
    (sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
    0,
  );
  const activeReservationUnits = reservations.reduce((sum, reservation) => sum + reservation.quantity, 0);
  const activeReservationValue = getCurrentReservationValue();
  const openReminders = reminders.filter((reminder) => !reminder.completed).sort(compareReminders);
  const todayKey = getLocalDateKey(now);
  const todayOpenReminders = openReminders.filter((reminder) => reminder.dueDate === todayKey);
  const dueDraftsToday = getDueDraftsForToday(now);
  const activeArrivalProducts = getActiveArrivalProducts(now);
  const tomorrowOrders = orders.filter((order) => !isOrderCompleted(order) && isOrderForTomorrow(order, now));
  const tomorrowRevenue = tomorrowOrders.reduce((sum, order) => sum + getPaidSalesTotal(order.items), 0);
  const upcomingSundayKey = getUpcomingSundayLocalDateKey(now);
  const sundayOrders = orders.filter(
    (order) => !isOrderCompleted(order) && getOrderReportDateKey(order) === upcomingSundayKey,
  );
  const sundayRevenue = sundayOrders.reduce((sum, order) => sum + getPaidSalesTotal(order.items), 0);
  const averageOrder = monthOrders.length ? monthRevenue / monthOrders.length : 0;
  const collectionStats = getCollectionStats(collections);

  dom.dashboardStats.innerHTML = [
    dashboardTodayOrdersStat(todayOpenOrders.length),
    dashboardTomorrowOrdersStat(tomorrowOrders.length, tomorrowRevenue),
    isSundayInIsrael(now) ? "" : dashboardSundayOrdersStat(sundayOrders.length, sundayRevenue, upcomingSundayKey),
    dashboardMoneyStat("מכירות היום", todayRevenue, "today-sales", "today"),
    dashboardMoneyStat("מכירות החודש", monthRevenue, "sales", "month"),
    dashboardStat("הזמנות החודש", monthOrders.length.toLocaleString("he-IL"), "orders"),
    dashboardMoneyStat("מכירות השנה", yearRevenue, "lifetime", "year"),
    dashboardStat("שווי השריון", formatPrice(activeReservationValue), "reservations"),
    dashboardLinkStat("גיול פתוח", formatPrice(collectionStats.openAmount), "collections", "collections"),
    dashboardLinkStat("טיוטות פתוחות להיום", dueDraftsToday.length.toLocaleString("he-IL"), "today-drafts", "drafts"),
    dashboardActionStat("חוזרים למלאי", activeArrivalProducts.length.toLocaleString("he-IL"), "stock-arrivals", "stock-arrivals"),
    dashboardLinkStat("תזכורות פתוחות", openReminders.length.toLocaleString("he-IL"), "reminders", "reminders"),
    dashboardLinkStat("תזכורות להיום", todayOpenReminders.length.toLocaleString("he-IL"), "today-reminders", "reminders"),
    dashboardStat("לקוחות", customers.length.toLocaleString("he-IL"), "customers"),
  ].join("");

  const leadingCustomer = getLeadingCustomer(monthOrders);
  const reservationOrderUnits = monthOrders.reduce(
    (sum, order) => sum + order.items.filter(isReservationOrderItem).reduce((itemSum, item) => itemSum + item.quantity, 0),
    0,
  );
  const monthlyReleaseValue = getMonthlyReservationReleaseValue(now);
  dom.dashboardInsights.innerHTML = `
    ${dashboardInsight("ממוצע להזמנה החודש", formatPrice(averageOrder), "receipt")}
    ${dashboardInsight("יחידות שהוזמנו החודש", monthUnits.toLocaleString("he-IL"), "orders")}
    ${dashboardInsight("לקוח מוביל החודש", leadingCustomer?.name || "אין עדיין", "customers")}
    ${dashboardInsight("יחידות בשריון כעת", activeReservationUnits.toLocaleString("he-IL"), "reservations")}
    ${dashboardInsight("יחידות שיצאו משריון החודש", reservationOrderUnits.toLocaleString("he-IL"), "release")}
    ${dashboardInsight("שווי יציאות משריון החודש", formatPrice(monthlyReleaseValue), "trend")}
  `;

  renderDashboardTrends(now);
  renderDashboardRecentOrders();
  renderDashboardLowReservations();
  renderDashboardTopProducts();
  renderDashboardOpenReminders(openReminders);
}

function renderDashboardTrends(reference = new Date()) {
  if (!dom.dashboardTrends || !dom.dashboardTrendsMeta) return;

  const analysis = getDashboardTrendAnalysis(reference);
  dom.dashboardTrendsMeta.textContent = "30 ימים אחרונים מול 30 ימים קודמים · לא תחזית";

  if (!analysis.current.orderCount && !analysis.previous.orderCount) {
    dom.dashboardTrends.replaceChildren(
      dashboardEmpty("אין עדיין מספיק מכר מתועד לניתוח מגמות. המגמות יתחילו להופיע אחרי הזמנות שנשמרו במערכת."),
    );
    renderDashboardSmartSignals(analysis, reference);
    return;
  }

  dom.dashboardTrends.replaceChildren(...analysis.trends.map(renderDashboardTrendCard));
  renderDashboardSmartSignals(analysis, reference);
}

function getDashboardTrendAnalysis(reference = new Date()) {
  const periods = getDashboardTrendPeriods(reference);
  const current = getDashboardTrendPeriodStats(
    orders.filter((order) => isOrderInDashboardTrendPeriod(order, periods.currentStart, periods.currentEnd)),
  );
  const previous = getDashboardTrendPeriodStats(
    orders.filter((order) => isOrderInDashboardTrendPeriod(order, periods.previousStart, periods.previousEnd)),
  );
  const sharedAccuracy = getTrendDataAccuracy(current, previous);
  const product = getStableProductTrend(current, previous);

  return {
    periods,
    current,
    previous,
    trends: [
      createDashboardTrend({
        label: "מכר כספי",
        currentValue: current.revenue,
        previousValue: previous.revenue,
        formatValue: formatPrice,
        sample: current.orderCount + previous.orderCount,
        baselineMinimum: 1,
        sampleMinimum: 6,
        baselineSample: previous.orderCount,
        baselineSampleMinimum: 3,
        accuracy: sharedAccuracy,
      }),
      createDashboardTrend({
        label: "כמות מוצרים שנמכרה",
        currentValue: current.units,
        previousValue: previous.units,
        formatValue: (value) => `${value.toLocaleString("he-IL")} יח׳`,
        sample: current.orderCount + previous.orderCount,
        baselineMinimum: 6,
        sampleMinimum: 6,
        baselineSample: previous.orderCount,
        baselineSampleMinimum: 3,
        accuracy: sharedAccuracy,
      }),
      createDashboardTrend({
        label: "לקוחות פעילים",
        currentValue: current.customerCount,
        previousValue: previous.customerCount,
        formatValue: (value) => `${value.toLocaleString("he-IL")} לקוחות`,
        sample: current.customerCount + previous.customerCount,
        baselineMinimum: 2,
        sampleMinimum: 5,
        baselineSample: previous.customerCount,
        baselineSampleMinimum: 2,
        accuracy: sharedAccuracy,
      }),
      product
        ? createDashboardTrend({
            label: `מגמת מוצר · ${product.label}`,
            currentValue: product.current.units,
            previousValue: product.previous.units,
            formatValue: (value) => `${value.toLocaleString("he-IL")} יח׳`,
            sample: product.current.orderCount + product.previous.orderCount,
            baselineMinimum: 3,
            sampleMinimum: 3,
            baselineSample: product.previous.orderCount,
            baselineSampleMinimum: 2,
            accuracy: product.accuracy,
            importanceMultiplier: product.importanceMultiplier,
          })
        : createInsufficientProductTrend(sharedAccuracy),
    ],
  };
}

function getDashboardTrendPeriods(reference, days = 30) {
  const currentEnd = getLocalDateKey(reference);
  const currentStart = shiftLocalDateKeyByDays(currentEnd, -(days - 1));
  const previousEnd = shiftLocalDateKeyByDays(currentStart, -1);
  const previousStart = shiftLocalDateKeyByDays(previousEnd, -(days - 1));
  return { currentStart, currentEnd, previousStart, previousEnd };
}

function shiftLocalDateKeyByDays(value, offset) {
  const date = getDateFromLocalKey(value);
  date.setDate(date.getDate() + offset);
  return getLocalDateKey(date);
}

function isOrderInDashboardTrendPeriod(order, start, end) {
  const dateKey = getOrderReportDateKey(order);
  return Boolean(dateKey && dateKey >= start && dateKey <= end);
}

function getDashboardTrendPeriodStats(orderList) {
  const customersInPeriod = new Set();
  const customersByKey = new Map();
  const productsByKey = new Map();
  let revenue = 0;
  let units = 0;
  let orderCount = 0;
  let totalLines = 0;
  let completeLines = 0;

  orderList.forEach((order) => {
    let hasPaidLine = false;
    const customer = getOrderCustomer(order);
    const customerKey = customer?.id || normalizeSearch(order.customerName);
    const customerName = cleanString(customer?.name || order.customerName || "לקוח ללא שם");

    order.items.forEach((item) => {
      if (isReservationOrderItem(item)) return;
      totalLines += 1;
      const quantity = parseTrendQuantity(item.quantity);
      const isBonus = isBonusOrderItem(item);
      const unitPrice = Number(item.unitPrice);
      const validLine = quantity !== null && (isBonus || Number.isFinite(unitPrice));
      if (!validLine) return;

      completeLines += 1;
      hasPaidLine = true;
      units += quantity;
      const lineRevenue = isBonus ? 0 : roundMoney(quantity * unitPrice);
      revenue = roundMoney(revenue + lineRevenue);

      const key = item.skuKey || item.sku || item.description || "מוצר";
      const label = cleanString(item.description || item.sku || "מוצר ללא שם");
      const product = productsByKey.get(key) || {
        label,
        units: 0,
        revenue: 0,
        orderIds: new Set(),
        totalLines: 0,
        completeLines: 0,
      };
      product.units += quantity;
      product.revenue = roundMoney(product.revenue + lineRevenue);
      product.orderIds.add(order.id);
      product.totalLines += 1;
      product.completeLines += 1;
      productsByKey.set(key, product);

      if (customerKey) {
        const customerStats = customersByKey.get(customerKey) || {
          name: customerName,
          revenue: 0,
          units: 0,
          orderIds: new Set(),
        };
        customerStats.revenue = roundMoney(customerStats.revenue + lineRevenue);
        customerStats.units += quantity;
        customerStats.orderIds.add(order.id);
        customersByKey.set(customerKey, customerStats);
      }
    });

    if (!hasPaidLine) return;
    orderCount += 1;
    if (customerKey) customersInPeriod.add(customerKey);
  });

  return {
    revenue: roundMoney(revenue),
    units,
    orderCount,
    customerCount: customersInPeriod.size,
    totalLines,
    completeLines,
    productsByKey,
    customersByKey,
  };
}

function getStableProductTrend(current, previous) {
  const keys = new Set([...current.productsByKey.keys(), ...previous.productsByKey.keys()]);
  const candidates = [...keys]
    .map((key) => {
      const currentProduct = current.productsByKey.get(key) || emptyTrendProduct();
      const previousProduct = previous.productsByKey.get(key) || emptyTrendProduct();
      const orderCount = new Set([...currentProduct.orderIds, ...previousProduct.orderIds]).size;
      const totalUnits = currentProduct.units + previousProduct.units;
      const hasReliableBaseline = previousProduct.units >= 3 && totalUnits >= 8 && orderCount >= 3;
      return {
        label: currentProduct.label || previousProduct.label || "מוצר",
        current: { units: currentProduct.units, orderCount: currentProduct.orderIds.size },
        previous: { units: previousProduct.units, orderCount: previousProduct.orderIds.size },
        hasReliableBaseline,
        accuracy: getTrendItemAccuracy(currentProduct, previousProduct),
        importanceMultiplier: totalUnits ? Math.min(1, totalUnits / Math.max(8, current.units + previous.units || 1)) : 0,
        movement: Math.abs(currentProduct.units - previousProduct.units),
      };
    })
    .filter((candidate) => candidate.hasReliableBaseline)
    .sort((a, b) => b.movement - a.movement || b.current.units - a.current.units);
  return candidates[0] || null;
}

function emptyTrendProduct() {
  return { label: "", units: 0, revenue: 0, orderIds: new Set(), totalLines: 0, completeLines: 0 };
}

function getTrendDataAccuracy(current, previous) {
  return getTrendItemAccuracy(current, previous);
}

function getTrendItemAccuracy(current, previous) {
  const total = Number(current.totalLines || 0) + Number(previous.totalLines || 0);
  const complete = Number(current.completeLines || 0) + Number(previous.completeLines || 0);
  return total ? Math.round((complete / total) * 100) : 0;
}

function parseTrendQuantity(value) {
  const quantity = Number.parseInt(value, 10);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function createDashboardTrend({
  label,
  currentValue,
  previousValue,
  formatValue,
  sample,
  baselineMinimum,
  sampleMinimum,
  baselineSample = sample,
  baselineSampleMinimum = 1,
  accuracy,
  importanceMultiplier = 1,
}) {
  const delta = currentValue - previousValue;
  const hasBaseline =
    previousValue >= baselineMinimum && sample >= sampleMinimum && baselineSample >= baselineSampleMinimum;
  const percentChange = hasBaseline ? (delta / previousValue) * 100 : null;
  const reliability = calculateTrendReliability({
    sample,
    baselineSample,
    baselineSampleMinimum,
    sampleMinimum,
    accuracy,
    hasBaseline,
  });
  const importance = calculateTrendImportance({ currentValue, previousValue, sample, sampleMinimum, importanceMultiplier });
  const direction = !hasBaseline ? "insufficient" : delta > 0 ? "up" : delta < 0 ? "down" : "steady";
  const directionLabel = !hasBaseline
    ? "אין בסיס יציב להשוואת אחוזים"
    : delta > 0
      ? `עלייה של ${Math.abs(percentChange).toLocaleString("he-IL", { maximumFractionDigits: 0 })}%`
      : delta < 0
        ? `ירידה של ${Math.abs(percentChange).toLocaleString("he-IL", { maximumFractionDigits: 0 })}%`
        : "ללא שינוי מהותי";

  return {
    label,
    direction,
    directionLabel,
    currentLabel: formatValue(currentValue),
    previousLabel: formatValue(previousValue),
    reliability,
    accuracy,
    importance,
    hasBaseline,
  };
}

function createInsufficientProductTrend(accuracy) {
  return {
    label: "מגמת מוצר",
    direction: "insufficient",
    directionLabel: "עדיין אין מוצר עם בסיס מכר חוזר מספיק",
    currentLabel: "ממתין לנתונים",
    previousLabel: "לא מוצג אחוז מטעה",
    reliability: { score: 20, tier: "red", label: "נמוכה" },
    accuracy,
    importance: 20,
    hasBaseline: false,
  };
}

function calculateTrendReliability({ sample, baselineSample, baselineSampleMinimum, sampleMinimum, accuracy, hasBaseline }) {
  const baselineScore = Math.min(1, baselineSample / Math.max(1, baselineSampleMinimum)) * 40;
  const sampleScore = Math.min(1, sample / Math.max(1, sampleMinimum)) * 35;
  const accuracyScore = Math.min(100, Math.max(0, accuracy)) * 0.25;
  const rawScore = Math.round(baselineScore + sampleScore + accuracyScore);
  const score = hasBaseline ? rawScore : Math.min(45, rawScore);
  const tier = score >= 75 ? "green" : score >= 50 ? "orange" : "red";
  return { score, tier, label: tier === "green" ? "גבוהה" : tier === "orange" ? "בינונית" : "נמוכה" };
}

function calculateTrendImportance({ currentValue, previousValue, sample, sampleMinimum, importanceMultiplier }) {
  const largest = Math.max(Math.abs(currentValue), Math.abs(previousValue), 1);
  const movement = Math.min(1, Math.abs(currentValue - previousValue) / largest);
  const evidence = Math.min(1, sample / Math.max(1, sampleMinimum));
  return Math.round(Math.min(100, (25 + movement * 50 + evidence * 25) * Math.max(0.45, importanceMultiplier)));
}

function renderDashboardTrendCard(trend) {
  const card = document.createElement("article");
  card.className = `dashboard-trend-card reliability-${trend.reliability.tier}`;
  const directionSymbol = trend.direction === "up" ? "↗" : trend.direction === "down" ? "↘" : trend.direction === "steady" ? "→" : "•";
  card.innerHTML = `
    <div class="dashboard-trend-heading">
      <span>${escapeHtml(trend.label)}</span>
      <b class="dashboard-trend-signal ${escapeHtml(trend.direction)}">${directionSymbol} ${escapeHtml(trend.directionLabel)}</b>
    </div>
    <div class="dashboard-trend-values">
      <strong>${escapeHtml(trend.currentLabel)}</strong>
      <span>לעומת ${escapeHtml(trend.previousLabel)}</span>
    </div>
    <div class="dashboard-trend-metrics">
      <span class="trend-reliability ${trend.reliability.tier}"><i></i>אמינות ${escapeHtml(trend.reliability.label)} ${trend.reliability.score}%</span>
      <span>דיוק ${Math.round(trend.accuracy)}%</span>
      <span>חשיבות ${Math.round(trend.importance)}%</span>
    </div>
  `;
  return card;
}

function renderDashboardSmartSignals(analysis, reference = new Date()) {
  if (!dom.dashboardSignals) return;
  const signals = getDashboardSmartSignals(analysis, reference);
  if (!signals.length) {
    dom.dashboardSignals.replaceChildren(dashboardEmpty("המדדים יופיעו לאחר שתישמר פעילות מכר."));
    return;
  }
  dom.dashboardSignals.replaceChildren(...signals.map(renderDashboardSmartSignal));
}

function getDashboardSmartSignals(analysis, reference) {
  const current = analysis.current;
  const customerRows = [...current.customersByKey.values()];
  const productRows = [...current.productsByKey.values()];
  const currentOrders = orders.filter((order) =>
    isOrderInDashboardTrendPeriod(order, analysis.periods.currentStart, analysis.periods.currentEnd),
  );
  if (!currentOrders.length) return [];

  const activeCustomers = customerRows.length;
  const repeatCustomers = customerRows.filter((customer) => customer.orderIds.size >= 2).length;
  const repeatRate = activeCustomers ? Math.round((repeatCustomers / activeCustomers) * 100) : 0;
  const topCustomer = [...customerRows].sort((a, b) => b.revenue - a.revenue || b.units - a.units)[0] || null;
  const topCustomerShare = getDashboardShare(topCustomer?.revenue || topCustomer?.units || 0, current.revenue || current.units);
  const topProducts = [...productRows].sort((a, b) => b.revenue - a.revenue || b.units - a.units).slice(0, 3);
  const topProductsValue = topProducts.reduce(
    (sum, product) => sum + (current.revenue ? product.revenue : product.units),
    0,
  );
  const topProductsShare = getDashboardShare(topProductsValue, current.revenue || current.units);

  const todayKey = getLocalDateKey(reference);
  const openPipelineOrders = orders.filter(
    (order) => !isOrderCompleted(order) && getOrderReportDateKey(order) > todayKey,
  );
  const pipelineValue = openPipelineOrders.reduce((sum, order) => sum + getPaidSalesTotal(order.items), 0);
  const reservationMix = getDashboardReservationMix(currentOrders);
  const weeklyMomentum = getDashboardWeeklyMomentum(reference);

  return [
    {
      label: "שימור לקוחות",
      value: activeCustomers ? `${repeatRate}%` : "אין נתונים",
      detail: activeCustomers
        ? `${repeatCustomers.toLocaleString("he-IL")} מתוך ${activeCustomers.toLocaleString("he-IL")} לקוחות חזרו להזמין`
        : "אין לקוחות פעילים ב־30 הימים האחרונים",
      tone: activeCustomers < 4 ? "red" : repeatRate >= 45 ? "green" : repeatRate >= 25 ? "orange" : "red",
    },
    {
      label: "תלות בלקוח מוביל",
      value: topCustomer ? `${topCustomerShare}%` : "אין נתונים",
      detail: topCustomer
        ? `${topCustomer.name} אחראי ל־${formatDashboardSignalValue(topCustomer.revenue, topCustomer.units)}`
        : "אין מכר מתועד בתקופה",
      tone: topCustomerShare <= 35 ? "green" : topCustomerShare <= 55 ? "orange" : "red",
    },
    {
      label: "ריכוז מוצרים",
      value: topProducts.length ? `${topProductsShare}%` : "אין נתונים",
      detail: topProducts.length
        ? `${topProducts.length.toLocaleString("he-IL")} המוצרים המובילים מחזיקים בחלק זה מהמכר`
        : "אין מכר מוצרי בתקופה",
      tone: topProductsShare <= 60 ? "green" : topProductsShare <= 80 ? "orange" : "red",
    },
    {
      label: "צבר הזמנות פתוח",
      value: openPipelineOrders.length ? `${openPipelineOrders.length.toLocaleString("he-IL")} הזמנות` : "אין צבר",
      detail: openPipelineOrders.length
        ? `${formatPrice(pipelineValue)} להזמנות שמדווחות אחרי היום · לא תחזית`
        : "אין הזמנות פתוחות שמדווחות אחרי היום",
      tone: "blue",
    },
    {
      label: "קצב מכר · 7 ימים",
      value: weeklyMomentum.label,
      detail: weeklyMomentum.detail,
      tone: weeklyMomentum.tone,
    },
    {
      label: "שילוב מכר משריון",
      value: reservationMix.totalUnits ? `${reservationMix.share}%` : "אין נתונים",
      detail: reservationMix.totalUnits
        ? `${reservationMix.reservationUnits.toLocaleString("he-IL")} יח׳ משריון מתוך ${reservationMix.totalUnits.toLocaleString("he-IL")} יח׳ בתקופה`
        : "לא נרשמו יחידות ב־30 הימים האחרונים",
      tone: reservationMix.share <= 35 ? "green" : reservationMix.share <= 60 ? "orange" : "red",
    },
  ];
}

function getDashboardShare(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (part / total) * 100)));
}

function formatDashboardSignalValue(revenue, units) {
  return revenue > 0 ? formatPrice(revenue) : `${units.toLocaleString("he-IL")} יח׳`;
}

function getDashboardReservationMix(orderList) {
  const summary = orderList.reduce(
    (summary, order) => {
      order.items.forEach((item) => {
        const quantity = parseTrendQuantity(item.quantity);
        if (quantity === null) return;
        summary.totalUnits += quantity;
        if (isReservationOrderItem(item)) summary.reservationUnits += quantity;
      });
      return summary;
    },
    { totalUnits: 0, reservationUnits: 0, share: 0 },
  );
  return { ...summary, share: getDashboardShare(summary.reservationUnits, summary.totalUnits) };
}

function getDashboardWeeklyMomentum(reference) {
  const end = getLocalDateKey(reference);
  const start = shiftLocalDateKeyByDays(end, -6);
  const previousEnd = shiftLocalDateKeyByDays(start, -1);
  const previousStart = shiftLocalDateKeyByDays(previousEnd, -6);
  const current = getDashboardTrendPeriodStats(
    orders.filter((order) => isOrderInDashboardTrendPeriod(order, start, end)),
  );
  const previous = getDashboardTrendPeriodStats(
    orders.filter((order) => isOrderInDashboardTrendPeriod(order, previousStart, previousEnd)),
  );
  const hasBaseline = previous.orderCount >= 2 && current.orderCount + previous.orderCount >= 4 && previous.revenue > 0;
  if (!hasBaseline) {
    return {
      label: "אין בסיס",
      detail: `${formatPrice(current.revenue)} ב־7 הימים האחרונים · לא מוצג אחוז לפני שיש מספיק הזמנות`,
      tone: "orange",
    };
  }

  const change = ((current.revenue - previous.revenue) / previous.revenue) * 100;
  const direction = change > 0 ? "עלייה" : change < 0 ? "ירידה" : "יציב";
  return {
    label: `${direction} ${Math.abs(change).toLocaleString("he-IL", { maximumFractionDigits: 0 })}%`,
    detail: `${formatPrice(current.revenue)} לעומת ${formatPrice(previous.revenue)} בשבעת הימים הקודמים`,
    tone: change > 0 ? "green" : change < 0 ? "orange" : "blue",
  };
}

function renderDashboardSmartSignal(signal) {
  const card = document.createElement("article");
  card.className = `dashboard-smart-signal ${signal.tone}`;
  card.innerHTML = `
    <span>${escapeHtml(signal.label)}</span>
    <strong>${escapeHtml(signal.value)}</strong>
    <small>${escapeHtml(signal.detail)}</small>
  `;
  return card;
}

function getDueDraftsForToday(reference = new Date()) {
  const todayKey = getLocalDateKey(reference);
  return drafts
    .filter((draft) => {
      const dueDate = normalizeDateInput(draft.draftReminderDate);
      return Boolean(dueDate && dueDate <= todayKey);
    })
    .sort(compareOrdersByCreatedAt);
}

function getActiveArrivalProducts(reference = new Date()) {
  return products.filter((product) => isActiveArrivalDate(getAnnotation(product).arrivalDate, reference));
}

function dashboardStat(label, value, tone) {
  return `
    <div class="dashboard-stat ${tone}">
      ${dashboardStatHeading(label, tone)}
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function dashboardLinkStat(label, value, tone, tab) {
  return `
    <button type="button" class="dashboard-stat dashboard-link-stat ${tone}" data-dashboard-tab="${tab}">
      ${dashboardStatHeading(label, tone)}
      <strong>${escapeHtml(value)}</strong>
    </button>
  `;
}

function dashboardActionStat(label, value, tone, action) {
  return `
    <button type="button" class="dashboard-stat dashboard-link-stat ${tone}" data-dashboard-action="${action}">
      ${dashboardStatHeading(label, tone)}
      <strong>${escapeHtml(value)}</strong>
    </button>
  `;
}

function dashboardTodayOrdersStat(orderCount) {
  const value = orderCount.toLocaleString("he-IL");
  const countControl = orderCount
    ? `<button type="button" class="dashboard-order-count-action" data-dashboard-action="today-orders" aria-label="הצג ${escapeHtml(value)} הזמנות פתוחות להיום">
        <strong>${escapeHtml(value)}</strong>
      </button>`
    : `<strong>0</strong>`;

  return `
    <div class="dashboard-stat today-orders dashboard-order-count-only">
      ${dashboardStatHeading("הזמנות היום", "today-orders")}
      ${countControl}
    </div>
  `;
}

function dashboardTomorrowOrdersStat(orderCount, grossValue) {
  const excludeVat = dashboardVatExclusion.tomorrow;
  const displayValue = excludeVat ? roundMoney(grossValue / (1 + VAT_RATE)) : grossValue;
  const vatLabel = excludeVat ? "ללא מע״מ" : "כולל מע״מ";
  return `
    <div class="dashboard-stat tomorrow-orders dashboard-split-stat dashboard-split-compact dashboard-order-count-only">
      ${dashboardStatHeading("הזמנות למחר", "tomorrow-orders")}
      <div class="dashboard-split-values">
        <div class="dashboard-split-value dashboard-split-count">
          <button type="button" class="dashboard-order-count-action" data-dashboard-action="tomorrow-orders" aria-label="הצג ${escapeHtml(orderCount.toLocaleString("he-IL"))} הזמנות פתוחות למחר">
            <strong>${escapeHtml(orderCount.toLocaleString("he-IL"))}</strong>
          </button>
          <small>הזמנות</small>
        </div>
        <button type="button" class="dashboard-split-value dashboard-split-money" data-toggle-dashboard-vat="tomorrow" aria-pressed="${excludeVat}">
          <strong>${escapeHtml(formatPrice(displayValue))}</strong>
          <small>${vatLabel}</small>
        </button>
      </div>
    </div>
  `;
}

function dashboardSundayOrdersStat(orderCount, grossValue, sundayKey) {
  const excludeVat = dashboardVatExclusion.sunday;
  const displayValue = excludeVat ? roundMoney(grossValue / (1 + VAT_RATE)) : grossValue;
  const vatLabel = excludeVat ? "ללא מע״מ" : "כולל מע״מ";
  const sundayLabel = formatSundayOrderDate(sundayKey);
  const countControl = orderCount
    ? `<div class="dashboard-split-value dashboard-split-count">
        <button type="button" class="dashboard-order-count-action" data-dashboard-action="sunday-orders" aria-label="הצג ${escapeHtml(orderCount.toLocaleString("he-IL"))} הזמנות פתוחות ליום ראשון ${escapeHtml(sundayLabel)}">
          <strong>${escapeHtml(orderCount.toLocaleString("he-IL"))}</strong>
        </button>
        <small>${escapeHtml(sundayLabel)} · הזמנות פתוחות</small>
      </div>`
    : `<div class="dashboard-split-value dashboard-split-count" aria-label="אין הזמנות פתוחות ליום ראשון ${escapeHtml(sundayLabel)}">
        <strong>0</strong>
        <small>${escapeHtml(sundayLabel)} · אין הזמנות</small>
      </div>`;
  return `
    <div class="dashboard-stat sunday-orders dashboard-split-stat dashboard-split-compact dashboard-order-count-only">
      ${dashboardStatHeading("הזמנות ליום ראשון", "sunday-orders")}
      <div class="dashboard-split-values">
        ${countControl}
        <button type="button" class="dashboard-split-value dashboard-split-money" data-toggle-dashboard-vat="sunday" aria-pressed="${excludeVat}">
          <strong>${escapeHtml(formatPrice(displayValue))}</strong>
          <small>${vatLabel}</small>
        </button>
      </div>
    </div>
  `;
}

function dashboardMoneyStat(label, grossValue, tone, period) {
  const excludeVat = dashboardVatExclusion[period];
  const displayValue = excludeVat ? roundMoney(grossValue / (1 + VAT_RATE)) : grossValue;
  const vatLabel = excludeVat ? "ללא מע״מ" : "כולל מע״מ";
  return `
    <div class="dashboard-stat ${tone} dashboard-money-stat">
      ${dashboardStatHeading(label, tone)}
      <button type="button" class="dashboard-money-value" data-toggle-dashboard-vat="${period}" aria-pressed="${excludeVat}">
        <strong>${escapeHtml(formatPrice(displayValue))}</strong>
        <small>${vatLabel}</small>
      </button>
    </div>
  `;
}

function dashboardInsight(label, value, icon) {
  return `
    <div class="dashboard-insight">
      <div>
        <span class="dashboard-insight-label">${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
      ${dashboardIcon(icon)}
    </div>
  `;
}

function dashboardStatHeading(label, tone) {
  return `
    <div class="dashboard-stat-heading">
      <span class="dashboard-stat-label">${escapeHtml(label)}</span>
      ${dashboardIcon(getDashboardIconName(tone))}
    </div>
  `;
}

function getDashboardIconName(tone) {
  const icons = {
    "today-orders": "orders",
    "tomorrow-orders": "calendar",
    "sunday-orders": "calendar",
    "today-sales": "bolt",
    sales: "trend",
    orders: "receipt",
    lifetime: "chart",
    reservations: "reservations",
    collections: "wallet",
    "today-drafts": "draft",
    "stock-arrivals": "arrival",
    reminders: "bell",
    "today-reminders": "bell",
    customers: "customers",
  };
  return icons[tone] || "chart";
}

function dashboardIcon(name) {
  const paths = {
    arrival: '<path d="M3.5 6.5h10v10h-10zM13.5 10.5h3l3 3v3h-6zM7 17v2M17 17v2M5.5 19h3M15.5 19h3" />',
    bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 22h4" />',
    bolt: '<path d="m13 2-9 12h7l-1 8 9-12h-7z" />',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h5" />',
    chart: '<path d="M4 19V5M4 19h16M8 15l3-3 3 2 5-6M15 8h4v4" />',
    customers: '<path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-4A4.5 4.5 0 0 0 3 18.5V20M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M17 14a4 4 0 0 1 4 4v2M15.5 3.3a3.5 3.5 0 0 1 0 6.7" />',
    draft: '<path d="M6 3h8l4 4v14H6zM14 3v5h5M9 15l5-5 2 2-5 5-3 1z" />',
    orders: '<rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" />',
    receipt: '<path d="M6 3h12v18l-2.5-1.5L12 21l-3.5-1.5L6 21zM9 8h6M9 12h6M9 16h4" />',
    release: '<path d="M4 7h11v10H4zM15 10h3l2 2v5h-5zM8 17v2M17 17v2M3 19h7M14 19h6M11 3v7M8 7l3 3 3-3" />',
    reservations: '<path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4V11M20 7v10l-8 4" />',
    trend: '<path d="M4 19V5M4 19h16M7 15l3-3 3 2 6-7M15 7h4v4" />',
    wallet: '<path d="M4 7h15a2 2 0 0 1 2 2v10H4zM4 7V5a2 2 0 0 1 2-2h12M21 13h-6v4h6" />',
  };
  const path = paths[name] || paths.chart;
  return `<span class="dashboard-stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;
}

function renderDashboardRecentOrders() {
  if (!orders.length) {
    dom.dashboardRecentOrders.replaceChildren(dashboardEmpty("אין הזמנות שמורות."));
    return;
  }
  const rows = orders.slice(0, 5).map((order) => {
    const row = document.createElement("div");
    row.className = "dashboard-list-row";
    const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
    const reportLabel = getOrderReportLabel(order);
    row.innerHTML = `
      <div><strong>${escapeHtml(getOrderCustomer(order)?.name || order.customerName || "ללא לקוח")}</strong><span>${isReservationPurchaseOrder(order) ? "לשריון · " : ""}${escapeHtml(formatShortDateTime(order.createdAt))} · ${itemCount.toLocaleString("he-IL")} יח׳${reportLabel ? ` · ${escapeHtml(reportLabel)}` : ""}</span></div>
      <b>${escapeHtml(formatPrice(order.total))}</b>
    `;
    return row;
  });
  dom.dashboardRecentOrders.replaceChildren(...rows);
}

function renderDashboardLowReservations() {
  const low = reservations.filter((reservation) => reservation.quantity === 1).slice(0, 6);
  if (!low.length) {
    dom.dashboardLowReservations.replaceChildren(dashboardEmpty("אין יתרות של יחידה אחרונה."));
    return;
  }
  dom.dashboardLowReservations.replaceChildren(
    ...low.map((reservation) => {
      const row = document.createElement("div");
      row.className = "dashboard-list-row alert";
      const customer = customers.find((item) => item.id === reservation.customerId);
      row.innerHTML = `<div><strong>${escapeHtml(reservation.sku)}</strong><span>${escapeHtml(customer?.name || reservation.customerName)}</span></div><b>1 יח׳</b>`;
      return row;
    }),
  );
}

function renderDashboardTopProducts() {
  const productsBySales = new Map();
  orders.forEach((order) => {
    order.items.forEach((item) => {
      const current = productsBySales.get(item.skuKey) || {
        sku: item.sku,
        description: item.description,
        quantity: 0,
        revenue: 0,
      };
      current.quantity += item.quantity;
      current.revenue += item.quantity * item.unitPrice;
      productsBySales.set(item.skuKey, current);
    });
  });
  const top = [...productsBySales.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 5);
  if (!top.length) {
    dom.dashboardTopProducts.replaceChildren(dashboardEmpty("אין עדיין נתוני מכירה."));
    return;
  }
  dom.dashboardTopProducts.replaceChildren(
    ...top.map((item, index) => {
      const row = document.createElement("div");
      row.className = "dashboard-list-row ranked";
      row.innerHTML = `<span class="dashboard-rank">${index + 1}</span><div><strong>${escapeHtml(item.sku || item.description)}</strong><span>${item.quantity.toLocaleString("he-IL")} יח׳ · ${escapeHtml(formatPrice(item.revenue))}</span></div>`;
      return row;
    }),
  );
}

function renderSoldProductsPanel() {
  const query = normalizeSearch(dom.soldProductsSearch.value);
  const reports = getProductSalesReports();
  const filteredReports = query
    ? reports.filter((report) => report.searchText.includes(query))
    : reports;
  const visibleReports = filteredReports.slice(0, query ? 80 : 30);
  const stats = getSoldProductsStats(filteredReports);

  dom.soldProductsSummary.textContent = query
    ? `${filteredReports.length.toLocaleString("he-IL")} מתוך ${reports.length.toLocaleString("he-IL")} מוצרים`
    : `${reports.length.toLocaleString("he-IL")} מוצרים`;
  dom.soldProductsStats.replaceChildren(
    createSoldProductsStat("מוצרים שנמכרו", filteredReports.length.toLocaleString("he-IL")),
    createSoldProductsStat("סה״כ יחידות", stats.quantity.toLocaleString("he-IL")),
    createSoldProductsStat("מכירות בכסף", formatPrice(stats.paidRevenue), "ללא פריטים שיצאו משריון"),
    createSoldProductsStat("לקוחות שקנו", stats.customerCount.toLocaleString("he-IL")),
  );

  if (!reports.length) {
    dom.soldProductsList.replaceChildren(emptyState("אין עדיין מוצרים שנמכרו."));
    return;
  }

  if (!filteredReports.length) {
    dom.soldProductsList.replaceChildren(emptyState("לא נמצאו מכירות למוצר הזה."));
    return;
  }

  const nodes = visibleReports.map((report) => renderSoldProductCard(report, Boolean(query)));
  if (visibleReports.length < filteredReports.length) {
    const more = document.createElement("p");
    more.className = "sold-products-more";
    more.textContent = `מוצגים ${visibleReports.length.toLocaleString("he-IL")} מתוך ${filteredReports.length.toLocaleString("he-IL")} מוצרים. צמצם את החיפוש כדי לראות יותר מדויק.`;
    nodes.push(more);
  }
  dom.soldProductsList.replaceChildren(...nodes);
}

function createSoldProductsStat(label, value, hint = "") {
  const item = document.createElement("div");
  item.className = "sold-products-stat";
  item.innerHTML = `
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
  `;
  return item;
}

function getProductSalesReports() {
  const reports = new Map();

  orders.forEach((order) => {
    order.items.forEach((item) => {
      const skuKey = getSkuKey(item.skuKey || item.sku || item.description);
      if (!skuKey) return;
      const product = getProductBySku(item.skuKey || item.sku);
      const report = reports.get(skuKey) || {
        skuKey,
        sku: item.sku || product?.sku || skuKey,
        description: item.description || product?.description || "ללא תיאור",
        quantity: 0,
        paidRevenue: 0,
        reservationQuantity: 0,
        customerKeys: new Set(),
        purchases: [],
        searchParts: new Set([item.sku, item.description, product?.sku, product?.description]),
      };
      const customer = getOrderCustomer(order);
      const customerName = customer?.name || order.customerName || "ללא לקוח";
      const customerKey = customer?.id || normalizeSearch(customerName);
      const quantity = parseQuantity(item.quantity);
      const fromReservation = isReservationOrderItem(item);
      const paidTotal = fromReservation ? 0 : roundMoney(quantity * item.unitPrice);
      const sale = {
        orderId: order.id,
        orderType: order.orderType,
        customerName,
        customerKey,
        createdAt: order.createdAt,
        reportDate: getOrderReportDateKey(order),
        reportLabel: getOrderReportLabel(order),
        quantity,
        unitPrice: item.unitPrice,
        paidTotal,
        priceSource: item.priceSource,
        fromReservation,
      };

      report.quantity += quantity;
      report.paidRevenue = roundMoney(report.paidRevenue + paidTotal);
      report.reservationQuantity += fromReservation ? quantity : 0;
      if (customerKey) report.customerKeys.add(customerKey);
      report.purchases.push(sale);
      report.searchParts.add(customerName);
      report.searchParts.add(order.customerCode);
      report.searchParts.add(order.customerPhone);
      reports.set(skuKey, report);
    });
  });

  return [...reports.values()]
    .map((report) => {
      report.purchases.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      report.customerSales = getProductCustomerSales(report.purchases);
      report.customerCount = report.customerKeys.size;
      report.latestAt = report.purchases[0]?.createdAt || "";
      report.searchText = normalizeSearch([...report.searchParts].filter(Boolean).join(" "));
      return report;
    })
    .sort(
      (a, b) =>
        b.quantity - a.quantity ||
        b.paidRevenue - a.paidRevenue ||
        new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
    );
}

function getProductCustomerSales(purchases) {
  const salesByCustomer = new Map();

  purchases.forEach((sale) => {
    const customerKey = sale.customerKey || normalizeSearch(sale.customerName) || "unknown-customer";
    const current = salesByCustomer.get(customerKey) || {
      customerName: sale.customerName,
      customerKey,
      quantity: 0,
      paidRevenue: 0,
      reservationQuantity: 0,
      orderIds: new Set(),
      latestAt: sale.createdAt,
      latestReportLabel: sale.reportLabel,
      hasReservation: false,
      hasReservationPurchase: false,
      hasDisplayDiscount: false,
    };

    current.quantity += sale.quantity;
    current.paidRevenue = roundMoney(current.paidRevenue + sale.paidTotal);
    current.reservationQuantity += sale.fromReservation ? sale.quantity : 0;
    current.orderIds.add(sale.orderId);
    current.hasReservation = current.hasReservation || sale.fromReservation;
    current.hasReservationPurchase =
      current.hasReservationPurchase || (!sale.fromReservation && normalizeOrderType(sale.orderType) === "reservation");
    current.hasDisplayDiscount = current.hasDisplayDiscount || sale.priceSource === "display";
    if (new Date(sale.createdAt).getTime() > new Date(current.latestAt).getTime()) {
      current.latestAt = sale.createdAt;
      current.latestReportLabel = sale.reportLabel;
    }

    salesByCustomer.set(customerKey, current);
  });

  return [...salesByCustomer.values()]
    .map((sale) => ({
      ...sale,
      orderCount: sale.orderIds.size,
      orderIds: undefined,
    }))
    .sort(
      (a, b) =>
        b.quantity - a.quantity ||
        b.paidRevenue - a.paidRevenue ||
        new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
    );
}

function getSoldProductsStats(reports) {
  const customerKeys = new Set();
  return reports.reduce(
    (stats, report) => {
      stats.quantity += report.quantity;
      stats.paidRevenue = roundMoney(stats.paidRevenue + report.paidRevenue);
      report.customerKeys.forEach((customerKey) => customerKeys.add(customerKey));
      stats.customerCount = customerKeys.size;
      return stats;
    },
    { quantity: 0, paidRevenue: 0, customerCount: 0 },
  );
}

function renderSoldProductCard(report, openDetails) {
  const details = document.createElement("details");
  details.className = "sold-product-card";
  details.open = openDetails;

  const summary = document.createElement("summary");
  summary.className = "sold-product-summary";
  summary.innerHTML = `
    <div class="sold-product-title">
      <strong>${escapeHtml(report.sku || "ללא מק״ט")}</strong>
      <span>${escapeHtml(report.description || "ללא תיאור")}</span>
    </div>
    <div class="sold-product-kpis">
      <span>${report.quantity.toLocaleString("he-IL")} יח׳</span>
      <span>${escapeHtml(formatPrice(report.paidRevenue))}</span>
      <span>${report.customerCount.toLocaleString("he-IL")} לקוחות</span>
    </div>
  `;

  const rows = document.createElement("div");
  rows.className = "sold-product-buyers";
  const customerSales = openDetails ? report.customerSales : report.customerSales.slice(0, 5);
  rows.replaceChildren(...customerSales.map(renderSoldProductCustomerRow));

  if (!openDetails && report.customerSales.length > customerSales.length) {
    const hint = document.createElement("p");
    hint.className = "sold-products-more";
    hint.textContent = `ועוד ${(report.customerSales.length - customerSales.length).toLocaleString("he-IL")} לקוחות. חפש את הדגם כדי לפתוח פירוט מלא.`;
    rows.append(hint);
  }

  details.append(summary, rows);
  return details;
}

function renderSoldProductCustomerRow(sale) {
  const row = document.createElement("div");
  row.className = "sold-product-buyer-row";
  row.classList.toggle("reservation-order-item", sale.hasReservation);
  const date = new Date(sale.latestAt).toLocaleString("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const typeLabel = getSoldProductCustomerTypeLabel(sale);
  const orderCountLabel = `${sale.orderCount.toLocaleString("he-IL")} ${sale.orderCount === 1 ? "הזמנה" : "הזמנות"}`;
  const reservationLabel = sale.reservationQuantity
    ? `${sale.reservationQuantity.toLocaleString("he-IL")} יח׳ משריון`
    : "";
  const totalLabel = sale.paidRevenue > 0 ? formatPrice(sale.paidRevenue) : "משריון";
  row.innerHTML = `
    <div class="sold-product-customer">
      <strong>${escapeHtml(sale.customerName)}</strong>
      <span>${escapeHtml([`קנייה אחרונה ${date}`, sale.latestReportLabel, orderCountLabel, typeLabel, reservationLabel].filter(Boolean).join(" · "))}</span>
    </div>
    <div class="sold-product-sale-values">
      <span>${sale.quantity.toLocaleString("he-IL")} יח׳</span>
      <span>${escapeHtml(orderCountLabel)}</span>
      <b>${escapeHtml(totalLabel)}</b>
    </div>
  `;
  return row;
}

function getSoldProductCustomerTypeLabel(sale) {
  const labels = [];
  if (sale.hasReservation) labels.push("כולל יציאה משריון");
  if (sale.hasReservationPurchase) labels.push("כולל רכישה לשריון");
  if (sale.hasDisplayDiscount) labels.push("כולל הנחת תצוגה");
  return labels.join(" · ");
}

function getSoldProductSaleTypeLabel(sale) {
  if (sale.fromReservation) return "יצא משריון";
  if (normalizeOrderType(sale.orderType) === "reservation") return "נרכש לשריון";
  if (sale.priceSource === "display") return "מכירה · הנחת תצוגה";
  return "מכירה";
}

function renderCustomerSalesPanel() {
  const query = normalizeSearch(dom.customerSalesSearch.value);
  const reports = getCustomerSalesReports();
  const filteredReports = query
    ? reports.filter((report) => report.searchText.includes(query))
    : reports;
  const stats = getCustomerSalesStats(filteredReports);

  dom.customerSalesSummary.textContent = query
    ? `${filteredReports.length.toLocaleString("he-IL")} מתוך ${reports.length.toLocaleString("he-IL")} לקוחות`
    : `${reports.length.toLocaleString("he-IL")} לקוחות`;
  dom.customerSalesStats.replaceChildren(
    createCustomerSalesStat("לקוחות שקנו", filteredReports.length.toLocaleString("he-IL")),
    createCustomerSalesMoneyStat("סה״כ מכירות", stats.paidRevenue),
    createCustomerSalesStat("הזמנות בכסף", stats.orderCount.toLocaleString("he-IL")),
    createCustomerSalesStat("יחידות בכסף", stats.quantity.toLocaleString("he-IL")),
  );

  if (!reports.length) {
    dom.customerSalesList.replaceChildren(emptyState("אין עדיין מכירות כספיות לפי לקוחות."));
    return;
  }

  if (!filteredReports.length) {
    dom.customerSalesList.replaceChildren(emptyState("לא נמצאו לקוחות מתאימים."));
    return;
  }

  dom.customerSalesList.replaceChildren(
    ...filteredReports.slice(0, query ? 80 : 50).map((report, index) => renderCustomerSalesCard(report, index + 1, Boolean(query))),
  );
}

function createCustomerSalesStat(label, value) {
  const item = document.createElement("div");
  item.className = "customer-sales-stat";
  item.innerHTML = `
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
  `;
  return item;
}

function createCustomerSalesMoneyStat(label, value) {
  const item = document.createElement("div");
  item.className = "customer-sales-stat customer-sales-money-stat";
  item.innerHTML = `
    <span>${escapeHtml(label)}</span>
    ${createCustomerSalesMoneyButton(value, "customer-sales-stat-money")}
  `;
  return item;
}

function getCustomerSalesReports() {
  const reports = new Map();

  orders.forEach((order) => {
    const paidRevenue = getPaidSalesTotal(order.items);
    if (paidRevenue <= 0) return;

    const customer = getOrderCustomer(order);
    const customerName = customer?.name || order.customerName || "ללא לקוח";
    const customerKey = customer?.id || normalizeSearch(customerName) || `customer-${order.id}`;
    const paidQuantity = order.items
      .filter((item) => !isReservationOrderItem(item))
      .reduce((sum, item) => sum + item.quantity, 0);
    const reportDateKey = getOrderReportDateKey(order);
    const monthKey = reportDateKey.slice(0, 7);
    const report = reports.get(customerKey) || {
      customerKey,
      customerName,
      customerCode: customer?.code || order.customerCode || "",
      customerPhone: customer?.phone || order.customerPhone || "",
      paidRevenue: 0,
      quantity: 0,
      orderIds: new Set(),
      months: new Map(),
      latestAt: order.createdAt,
      searchParts: new Set([customerName, customer?.code, customer?.phone, order.customerCode, order.customerPhone]),
    };
    const month = report.months.get(monthKey) || {
      monthKey,
      label: formatMonthKey(monthKey),
      paidRevenue: 0,
      quantity: 0,
      orderIds: new Set(),
      latestAt: order.createdAt,
    };

    report.paidRevenue = roundMoney(report.paidRevenue + paidRevenue);
    report.quantity += paidQuantity;
    report.orderIds.add(order.id);
    if (new Date(order.createdAt).getTime() > new Date(report.latestAt).getTime()) report.latestAt = order.createdAt;

    month.paidRevenue = roundMoney(month.paidRevenue + paidRevenue);
    month.quantity += paidQuantity;
    month.orderIds.add(order.id);
    if (new Date(order.createdAt).getTime() > new Date(month.latestAt).getTime()) month.latestAt = order.createdAt;

    report.months.set(monthKey, month);
    reports.set(customerKey, report);
  });

  return [...reports.values()]
    .map((report) => ({
      ...report,
      orderCount: report.orderIds.size,
      monthRows: [...report.months.values()]
        .map((month) => ({
          ...month,
          orderCount: month.orderIds.size,
          orderIds: undefined,
        }))
        .sort((a, b) => b.monthKey.localeCompare(a.monthKey)),
      orderIds: undefined,
      months: undefined,
      searchText: normalizeSearch([...report.searchParts].filter(Boolean).join(" ")),
      searchParts: undefined,
    }))
    .sort(
      (a, b) =>
        b.paidRevenue - a.paidRevenue ||
        b.orderCount - a.orderCount ||
        new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
    );
}

function getCustomerSalesStats(reports) {
  return reports.reduce(
    (stats, report) => ({
      paidRevenue: roundMoney(stats.paidRevenue + report.paidRevenue),
      orderCount: stats.orderCount + report.orderCount,
      quantity: stats.quantity + report.quantity,
    }),
    { paidRevenue: 0, orderCount: 0, quantity: 0 },
  );
}

function renderCustomerSalesCard(report, rank, openDetails) {
  const card = document.createElement("details");
  card.className = "customer-sales-card";
  card.open = openDetails;

  const summary = document.createElement("summary");
  summary.className = "customer-sales-summary-row";
  const details = [report.customerCode ? `קוד ${report.customerCode}` : "", report.customerPhone].filter(Boolean).join(" · ");
  summary.innerHTML = `
    <span class="customer-sales-rank">${rank.toLocaleString("he-IL")}</span>
    <div class="customer-sales-title">
      <strong>${escapeHtml(report.customerName)}</strong>
      <span>${escapeHtml(details || "ללא קוד או טלפון")}</span>
    </div>
    <div class="customer-sales-kpis">
      ${createCustomerSalesMoneyButton(report.paidRevenue, "customer-sales-kpi-money")}
      <span>${report.orderCount.toLocaleString("he-IL")} הזמנות</span>
      <span>${report.quantity.toLocaleString("he-IL")} יח׳</span>
    </div>
  `;

  const months = document.createElement("div");
  months.className = "customer-sales-months";
  months.replaceChildren(...report.monthRows.map(renderCustomerSalesMonthRow));

  card.append(summary, months);
  return card;
}

function renderCustomerSalesMonthRow(month) {
  const row = document.createElement("div");
  row.className = "customer-sales-month-row";
  const latest = new Date(month.latestAt).toLocaleDateString("he-IL");
  row.innerHTML = `
    <div>
      <strong>${escapeHtml(month.label)}</strong>
      <span>${month.orderCount.toLocaleString("he-IL")} הזמנות · קנייה אחרונה ${escapeHtml(latest)}</span>
    </div>
    <div class="customer-sales-month-values">
      <span>${month.quantity.toLocaleString("he-IL")} יח׳</span>
      ${createCustomerSalesMoneyButton(month.paidRevenue, "customer-sales-month-money")}
    </div>
  `;
  return row;
}

function createCustomerSalesMoneyButton(value, className) {
  const displayValue = customerSalesExcludeVat ? roundMoney(value / (1 + VAT_RATE)) : value;
  const vatLabel = customerSalesExcludeVat ? "ללא מע״מ" : "כולל מע״מ";
  return `
    <button
      type="button"
      class="customer-sales-money-toggle ${className}"
      data-toggle-customer-sales-vat
      aria-pressed="${customerSalesExcludeVat}"
      title="לחץ להצגת סכומים ${customerSalesExcludeVat ? "כולל מע״מ" : "ללא מע״מ"}"
    >
      <strong>${escapeHtml(formatPrice(displayValue))}</strong>
      <small>${vatLabel}</small>
    </button>
  `;
}

function renderMonthlySalesPanel() {
  const reports = getMonthlySalesReports();
  const stats = getMonthlySalesStats(reports);

  dom.monthlySalesSummary.textContent = `${reports.length.toLocaleString("he-IL")} חודשים`;
  dom.monthlySalesStats.replaceChildren(
    createMonthlySalesStat("חודשים עם מכר", reports.length.toLocaleString("he-IL")),
    createMonthlySalesMoneyStat("סה״כ מכר", stats.paidRevenue),
    createMonthlySalesStat("הזמנות בכסף", stats.orderCount.toLocaleString("he-IL")),
    createMonthlySalesStat("יחידות בכסף", stats.quantity.toLocaleString("he-IL")),
    createMonthlySalesStat("נמשך משריון", `${stats.reservationQuantity.toLocaleString("he-IL")} יח׳`),
  );

  if (!reports.length) {
    dom.monthlySalesList.replaceChildren(emptyState("אין עדיין מכירות חודשיות."));
    return;
  }

  dom.monthlySalesList.replaceChildren(...reports.map(renderMonthlySalesCard));
}

function getMonthlySalesReports() {
  const reports = new Map();

  orders.forEach((order) => {
    const paidRevenue = getPaidSalesTotal(order.items);
    const reportDateKey = getOrderReportDateKey(order);
    const monthKey = reportDateKey.slice(0, 7);
    const paidQuantity = order.items
      .filter((item) => !isReservationOrderItem(item))
      .reduce((sum, item) => sum + item.quantity, 0);
    const reservationQuantity = order.items
      .filter((item) => isReservationOrderItem(item))
      .reduce((sum, item) => sum + item.quantity, 0);
    if (paidRevenue <= 0 && reservationQuantity <= 0) return;

    const customer = getOrderCustomer(order);
    const customerName = customer?.name || order.customerName || "ללא לקוח";
    const customerKey = customer?.id || normalizeSearch(customerName) || `customer-${order.id}`;
    const report = reports.get(monthKey) || {
      monthKey,
      label: formatMonthKey(monthKey),
      paidRevenue: 0,
      quantity: 0,
      reservationQuantity: 0,
      orderIds: new Set(),
      paidOrderIds: new Set(),
      reservationOrderIds: new Set(),
      customerKeys: new Set(),
      customers: new Map(),
      days: new Map(),
      latestAt: order.createdAt,
    };
    const customerRow = report.customers.get(customerKey) || {
      customerName,
      paidRevenue: 0,
      quantity: 0,
      reservationQuantity: 0,
      orderIds: new Set(),
      paidOrderIds: new Set(),
      reservationOrderIds: new Set(),
      latestAt: order.createdAt,
    };
    const dayRow = report.days.get(reportDateKey) || {
      dateKey: reportDateKey,
      label: formatMonthlySalesDay(reportDateKey),
      paidRevenue: 0,
      quantity: 0,
      reservationQuantity: 0,
      orderIds: new Set(),
      paidOrderIds: new Set(),
      reservationOrderIds: new Set(),
    };

    report.paidRevenue = roundMoney(report.paidRevenue + paidRevenue);
    report.quantity += paidQuantity;
    report.reservationQuantity += reservationQuantity;
    report.orderIds.add(order.id);
    if (paidRevenue > 0) report.paidOrderIds.add(order.id);
    if (reservationQuantity > 0) report.reservationOrderIds.add(order.id);
    report.customerKeys.add(customerKey);
    if (new Date(order.createdAt).getTime() > new Date(report.latestAt).getTime()) report.latestAt = order.createdAt;

    customerRow.paidRevenue = roundMoney(customerRow.paidRevenue + paidRevenue);
    customerRow.quantity += paidQuantity;
    customerRow.reservationQuantity += reservationQuantity;
    customerRow.orderIds.add(order.id);
    if (paidRevenue > 0) customerRow.paidOrderIds.add(order.id);
    if (reservationQuantity > 0) customerRow.reservationOrderIds.add(order.id);
    if (new Date(order.createdAt).getTime() > new Date(customerRow.latestAt).getTime()) customerRow.latestAt = order.createdAt;

    dayRow.paidRevenue = roundMoney(dayRow.paidRevenue + paidRevenue);
    dayRow.quantity += paidQuantity;
    dayRow.reservationQuantity += reservationQuantity;
    dayRow.orderIds.add(order.id);
    if (paidRevenue > 0) dayRow.paidOrderIds.add(order.id);
    if (reservationQuantity > 0) dayRow.reservationOrderIds.add(order.id);

    report.customers.set(customerKey, customerRow);
    report.days.set(reportDateKey, dayRow);
    reports.set(monthKey, report);
  });

  return [...reports.values()]
    .map((report) => ({
      ...report,
      orderCount: report.orderIds.size,
      paidOrderCount: report.paidOrderIds.size,
      reservationOrderCount: report.reservationOrderIds.size,
      customerCount: report.customerKeys.size,
      customerRows: [...report.customers.values()]
        .map((customer) => ({
          ...customer,
          orderCount: customer.orderIds.size,
          paidOrderCount: customer.paidOrderIds.size,
          reservationOrderCount: customer.reservationOrderIds.size,
          orderIds: undefined,
          paidOrderIds: undefined,
          reservationOrderIds: undefined,
        }))
        .sort((a, b) => b.paidRevenue - a.paidRevenue || b.reservationQuantity - a.reservationQuantity || b.quantity - a.quantity),
      dayRows: [...report.days.values()]
        .map((day) => ({
          ...day,
          orderCount: day.orderIds.size,
          paidOrderCount: day.paidOrderIds.size,
          reservationOrderCount: day.reservationOrderIds.size,
          orderIds: undefined,
          paidOrderIds: undefined,
          reservationOrderIds: undefined,
        }))
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
      orderIds: undefined,
      paidOrderIds: undefined,
      reservationOrderIds: undefined,
      customerKeys: undefined,
      customers: undefined,
      days: undefined,
    }))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
}

function formatMonthlySalesDay(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return date.toLocaleDateString("he-IL", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function getMonthlySalesStats(reports) {
  return reports.reduce(
    (stats, report) => ({
      paidRevenue: roundMoney(stats.paidRevenue + report.paidRevenue),
      orderCount: stats.orderCount + report.paidOrderCount,
      quantity: stats.quantity + report.quantity,
      reservationQuantity: stats.reservationQuantity + report.reservationQuantity,
    }),
    { paidRevenue: 0, orderCount: 0, quantity: 0, reservationQuantity: 0 },
  );
}

function createMonthlySalesStat(label, value) {
  const item = document.createElement("div");
  item.className = "monthly-sales-stat";
  item.innerHTML = `
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
  `;
  return item;
}

function createMonthlySalesMoneyStat(label, value) {
  const item = document.createElement("div");
  item.className = "monthly-sales-stat monthly-sales-money-stat";
  item.innerHTML = `
    <span>${escapeHtml(label)}</span>
    ${createMonthlySalesMoneyButton(value, "monthly-sales-stat-money")}
  `;
  return item;
}

function renderMonthlySalesCard(report) {
  const card = document.createElement("details");
  card.className = "monthly-sales-card";

  const summary = document.createElement("summary");
  summary.className = "monthly-sales-summary-row";
  const latest = new Date(report.latestAt).toLocaleDateString("he-IL");
  summary.innerHTML = `
    <div class="monthly-sales-title">
      <strong>${escapeHtml(report.label)}</strong>
      <span>${report.orderCount.toLocaleString("he-IL")} הזמנות · ${report.customerCount.toLocaleString("he-IL")} לקוחות · עדכון אחרון ${escapeHtml(latest)}</span>
    </div>
    <div class="monthly-sales-kpis">
      ${createMonthlySalesMoneyButton(report.paidRevenue, "monthly-sales-kpi-money")}
      <span>${report.quantity.toLocaleString("he-IL")} יח׳ בכסף</span>
      ${report.reservationQuantity ? `<span class="monthly-sales-reservation-kpi">${report.reservationQuantity.toLocaleString("he-IL")} יח׳ משריון</span>` : ""}
    </div>
  `;

  const breakdown = document.createElement("div");
  breakdown.className = "monthly-sales-breakdown";

  const daysSection = document.createElement("section");
  daysSection.className = "monthly-sales-section monthly-sales-days-section";
  daysSection.innerHTML = `
    <div class="monthly-sales-section-title">
      <div><span class="monthly-sales-section-icon" aria-hidden="true">◷</span><strong>מכר לפי יום</strong></div>
      <span>${report.dayRows.length.toLocaleString("he-IL")} ימים עם פעילות</span>
    </div>
  `;
  const days = document.createElement("div");
  days.className = "monthly-sales-days";
  days.replaceChildren(...report.dayRows.map(renderMonthlySalesDayRow));
  daysSection.append(days);

  const customersSection = document.createElement("section");
  customersSection.className = "monthly-sales-section monthly-sales-customers-section";
  customersSection.innerHTML = `
    <div class="monthly-sales-section-title">
      <div><span class="monthly-sales-section-icon customers" aria-hidden="true">♙</span><strong>פילוח לקוחות</strong></div>
      <span>${report.customerCount.toLocaleString("he-IL")} לקוחות</span>
    </div>
  `;
  const customers = document.createElement("div");
  customers.className = "monthly-sales-customers";
  customers.replaceChildren(...report.customerRows.map(renderMonthlySalesCustomerRow));
  customersSection.append(customers);

  breakdown.append(daysSection, customersSection);
  card.append(summary, breakdown);
  return card;
}

function renderMonthlySalesDayRow(day) {
  const row = document.createElement("div");
  row.className = "monthly-sales-day-row";
  const details = [
    `${day.orderCount.toLocaleString("he-IL")} הזמנות`,
    day.quantity ? `${day.quantity.toLocaleString("he-IL")} יח׳ בכסף` : "",
    day.reservationQuantity ? `${day.reservationQuantity.toLocaleString("he-IL")} יח׳ משריון` : "",
  ].filter(Boolean).join(" · ");
  row.innerHTML = `
    <div>
      <strong>${escapeHtml(day.label)}</strong>
      <span>${escapeHtml(details)}</span>
    </div>
    <div class="monthly-sales-day-values">
      ${createMonthlySalesMoneyButton(day.paidRevenue, "monthly-sales-day-money")}
      ${day.reservationQuantity ? `<span class="monthly-sales-reservation-pill">${day.reservationQuantity.toLocaleString("he-IL")} משריון</span>` : ""}
    </div>
  `;
  return row;
}

function renderMonthlySalesCustomerRow(customer) {
  const row = document.createElement("div");
  row.className = "monthly-sales-customer-row";
  const latest = new Date(customer.latestAt).toLocaleDateString("he-IL");
  const customerDetails = [
    `${customer.orderCount.toLocaleString("he-IL")} הזמנות`,
    customer.quantity ? `${customer.quantity.toLocaleString("he-IL")} יח׳ בכסף` : "",
    customer.reservationQuantity ? `${customer.reservationQuantity.toLocaleString("he-IL")} יח׳ משריון` : "",
    `קנייה אחרונה ${latest}`,
  ].filter(Boolean).join(" · ");
  row.innerHTML = `
    <div>
      <strong>${escapeHtml(customer.customerName)}</strong>
      <span>${escapeHtml(customerDetails)}</span>
    </div>
    <div class="monthly-sales-customer-values">
      <span>${customer.quantity.toLocaleString("he-IL")} יח׳</span>
      ${createMonthlySalesMoneyButton(customer.paidRevenue, "monthly-sales-customer-money")}
      ${customer.reservationQuantity ? `<span class="monthly-sales-reservation-pill">${customer.reservationQuantity.toLocaleString("he-IL")} משריון</span>` : ""}
    </div>
  `;
  return row;
}

function createMonthlySalesMoneyButton(value, className) {
  const displayValue = monthlySalesExcludeVat ? roundMoney(value / (1 + VAT_RATE)) : value;
  const vatLabel = monthlySalesExcludeVat ? "ללא מע״מ" : "כולל מע״מ";
  return `
    <button
      type="button"
      class="monthly-sales-money-toggle ${className}"
      data-toggle-monthly-sales-vat
      aria-pressed="${monthlySalesExcludeVat}"
      title="לחץ להצגת סכומים ${monthlySalesExcludeVat ? "כולל מע״מ" : "ללא מע״מ"}"
    >
      <strong>${escapeHtml(formatPrice(displayValue))}</strong>
      <small>${vatLabel}</small>
    </button>
  `;
}

function renderDashboardOpenReminders(openReminders) {
  if (!openReminders.length) {
    dom.dashboardOpenReminders.replaceChildren(dashboardEmpty("אין תזכורות פתוחות."));
    return;
  }
  dom.dashboardOpenReminders.replaceChildren(
    ...openReminders.slice(0, 5).map((reminder) => {
      const row = document.createElement("div");
      row.className = `dashboard-list-row${isReminderOverdue(reminder) ? " alert" : ""}`;
      const customer = getReminderCustomer(reminder);
      row.innerHTML = `<div><strong>${escapeHtml(reminder.title)}</strong><span>${escapeHtml([reminder.dueDate ? formatReminderDate(reminder.dueDate) : "ללא תאריך", customer?.name || reminder.customerName].filter(Boolean).join(" · "))}</span></div>`;
      return row;
    }),
  );
}

function dashboardEmpty(message) {
  const node = document.createElement("p");
  node.className = "dashboard-empty";
  node.textContent = message;
  return node;
}

function getLeadingCustomer(orderList) {
  const totals = new Map();
  orderList.forEach((order) => {
    const customer = getOrderCustomer(order);
    const key = customer?.id || normalizeSearch(order.customerName);
    if (!key) return;
    const current = totals.get(key) || { name: customer?.name || order.customerName, total: 0 };
    current.total += getOrderTotal(order.items);
    totals.set(key, current);
  });
  return [...totals.values()].sort((a, b) => b.total - a.total)[0] || null;
}

function compareReminders(a, b) {
  if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate !== b.dueDate) return a.dueDate ? -1 : 1;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function getReminderCustomer(reminder) {
  return customers.find((customer) => customer.id === reminder.customerId) || findCustomerByName(reminder.customerName);
}

function isReminderOverdue(reminder) {
  return Boolean(!reminder.completed && reminder.dueDate && reminder.dueDate < getLocalDateKey(new Date()));
}

function formatReminderDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("he-IL");
}

function formatSundayOrderDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("he-IL", { weekday: "short", day: "numeric", month: "numeric" });
}

function formatShortDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatShortDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function getOrderReportDateKey(order) {
  const storedDate = normalizeDateInput(order?.reportDate);
  if (storedDate) return storedDate;
  return getLocalDateKey(getSafeDate(order?.createdAt));
}

function getOrderReportDate(order) {
  return getDateFromLocalKey(getOrderReportDateKey(order));
}

function getOrderCreatedDateKey(order) {
  return getLocalDateKey(getSafeDate(order?.createdAt));
}

function getOrderReportDateForDraft(createdAt, reportTomorrow, reportToday = false) {
  const createdDate = getSafeDate(createdAt);
  if (reportToday) return getLocalDateKey(createdDate);
  const automaticDate = getAutomaticOrderReportDateKey(createdDate);
  if (!reportTomorrow) return automaticDate;
  const manualDate = getNextLocalDateKey(createdDate);
  return manualDate > automaticDate ? manualDate : automaticDate;
}

function getAutomaticOrderReportDateKey(createdAt) {
  const createdDate = getSafeDate(createdAt);
  const day = createdDate.getDay();
  if (day === 5 || day === 6) return getNextSundayLocalDateKey(createdDate);
  if (createdDate.getHours() < ORDER_REPORT_CUTOFF_HOUR) return getLocalDateKey(createdDate);
  if (day === 4) return getNextSundayLocalDateKey(createdDate);
  return getNextLocalDateKey(createdDate);
}

function getNextSundayLocalDateKey(date) {
  const nextDate = new Date(date);
  const daysUntilSunday = (7 - nextDate.getDay()) % 7 || 7;
  nextDate.setDate(nextDate.getDate() + daysUntilSunday);
  return getLocalDateKey(nextDate);
}

function getUpcomingSundayLocalDateKey(date) {
  const sundayDate = new Date(date);
  const daysUntilSunday = (7 - sundayDate.getDay()) % 7;
  sundayDate.setDate(sundayDate.getDate() + daysUntilSunday);
  return getLocalDateKey(sundayDate);
}

function isSundayInIsrael(date = new Date()) {
  return israelWeekdayFormatter.format(date) === "Sun";
}

function isOrderReportedTomorrow(order) {
  return getOrderReportDateKey(order) > getOrderCreatedDateKey(order);
}

function isOrderReportedToday(order) {
  const createdDate = getSafeDate(order?.createdAt);
  return (
    getOrderReportDateKey(order) === getLocalDateKey(createdDate) &&
    getAutomaticOrderReportDateKey(createdDate) !== getLocalDateKey(createdDate)
  );
}

function isOrderForTomorrow(order, reference = new Date()) {
  return getOrderReportDateKey(order) > getLocalDateKey(reference);
}

function isOrderCompleted(order) {
  return Boolean(cleanString(order?.completedAt));
}

function restoreCurrentDayOpenOrders() {
  const todayKey = getLocalDateKey(new Date());
  let restored = 0;

  orders = orders.map((order) => {
    if (!isOrderCompleted(order)) return order;
    if (getOrderCreatedDateKey(order) !== todayKey || getOrderReportDateKey(order) !== todayKey) return order;

    restored += 1;
    return { ...order, completedAt: "", updatedAt: new Date().toISOString() };
  });

  return restored;
}

function completeDueOrders(options = {}) {
  const todayKey = getLocalDateKey(new Date());
  const completeExistingOrders = Boolean(options.completeExistingOrders);
  let moved = 0;

  orders = orders.map((order) => {
    if (isOrderCompleted(order)) return order;
    const shouldComplete =
      getOrderReportDateKey(order) < todayKey ||
      (completeExistingOrders && !isOrderForTomorrow(order));
    if (!shouldComplete) return order;
    moved += 1;
    return { ...order, completedAt: new Date().toISOString() };
  });

  return moved;
}

function compareOrdersByCreatedAt(a, b) {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function getOrderReportLabel(order) {
  const reportDateKey = getOrderReportDateKey(order);
  if (reportDateKey === getOrderCreatedDateKey(order)) return "";
  if (reportDateKey < getLocalDateKey(new Date())) return "";
  return `דיווח: ${formatShortDate(`${reportDateKey}T12:00:00`)}`;
}

function isSameMonth(date, reference) {
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth()
  );
}

function isSameYear(date, reference) {
  return !Number.isNaN(date.getTime()) && date.getFullYear() === reference.getFullYear();
}

function isSameDay(date, reference) {
  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  );
}

function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getNextLocalDateKey(date) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);
  return getLocalDateKey(nextDate);
}

function getDateFromLocalKey(value) {
  const dateKey = normalizeDateInput(value);
  const date = dateKey ? new Date(`${dateKey}T12:00:00`) : new Date(NaN);
  return Number.isNaN(date.getTime()) ? getSafeDate() : date;
}

function getSafeDate(value = null) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeDateInput(value) {
  const date = cleanString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function getCustomerReservation(customer, skuKey) {
  if (!customer) return null;
  const normalizedKey = getSkuKey(skuKey);
  const customerName = normalizeSearch(customer.name);
  return (
    reservations.find(
      (reservation) =>
        reservation.skuKey === normalizedKey &&
        (reservation.customerId === customer.id || normalizeSearch(reservation.customerName) === customerName),
    ) || null
  );
}

function getReservationDescription(reservation) {
  return products.find((product) => product.skuKey === reservation.skuKey)?.description || reservation.description || "לא נמצא במחירון הנוכחי";
}

function getReservationCustomerName(reservation) {
  const customer = customers.find((item) => item.id === reservation.customerId);
  return customer?.name || reservation.customerName || "";
}

function createReservationToggle(labelText, dataAttribute, key, checked = false) {
  const label = document.createElement("label");
  label.className = "reservation-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset[dataAttribute] = key;
  input.checked = checked;
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(input, text);
  return label;
}

function addProductToCart(product, options = {}) {
  const quantity = parseQuantity(options.quantity);
  const useReservation = orderType === "delivery" && Boolean(options.fromReservation);
  const unitPrice = Math.max(0, parsePrice(options.unitPrice) ?? product.price);
  const priceSource = normalizePriceSource(options.priceSource || "list");
  const customer = getSelectedCustomer();
  const reservation = useReservation ? getCustomerReservation(customer, product.skuKey) : null;
  const reservedInCart = cart
    .filter((line) => line.fromReservation && line.skuKey === product.skuKey)
    .reduce((sum, line) => sum + line.quantity, 0);
  const editAllowance = getEditingReservationAllowance(customer, product.skuKey);
  const availableForNewItems = Math.max(0, (reservation?.quantity || 0) + editAllowance - reservedInCart);
  const reservedQuantity = useReservation ? Math.min(quantity, availableForNewItems) : 0;
  const pricedQuantity = quantity - reservedQuantity;

  if (reservedQuantity > 0) {
    upsertCartLine(product, reservedQuantity, {
      fromReservation: true,
      unitPrice: 0,
      priceSource: "reservation",
    });
  }
  if (pricedQuantity > 0) {
    upsertCartLine(product, pricedQuantity, {
      fromReservation: false,
      unitPrice,
      priceSource,
    });
  }

  cart = orderCartLines(cart);

  saveCart();
  render();
  dom.status.textContent =
    reservedQuantity > 0 && pricedQuantity > 0
      ? `${reservedQuantity} יח׳ נוספו מהשריון ו־${pricedQuantity} יח׳ במחיר שהוגדר.`
      : reservedQuantity > 0
        ? "הפריט נוסף מהשריון."
        : "הפריט נוסף לסל במחיר שהוגדר.";
}

function addTenPlusOneToCart(product, options = {}) {
  const unitPrice = Math.max(0, parsePrice(options.unitPrice) ?? product.price);
  const priceSource = normalizePriceSource(options.priceSource || "list");
  upsertCartLine(product, 10, {
    fromReservation: false,
    unitPrice,
    priceSource,
  });
  upsertCartLine(product, 1, {
    fromReservation: false,
    unitPrice: 0,
    priceSource: "bonus",
    bonusType: "ten-plus-one",
  });
  cart = orderCartLines(cart);
  saveCart();
  render();
  dom.status.textContent = `מבצע 10+1 נוסף: 10 יח׳ ב־${formatPrice(unitPrice)} ועוד יחידת בונוס ב־₪0.`;
}

function upsertCartLine(product, quantity, options) {
  const bonusType = normalizeBonusType(options.bonusType);
  const lineKey = createCartLineKey(
    product.skuKey,
    options.fromReservation,
    options.unitPrice,
    options.priceSource,
    bonusType,
  );
  const existing = cart.find((line) => line.lineKey === lineKey);
  if (existing) {
    existing.quantity += quantity;
    existing.unitPrice = options.unitPrice;
    existing.priceSource = options.priceSource;
    existing.bonusType = bonusType;
    return;
  }

  cart.push({
    lineKey,
    skuKey: product.skuKey,
    sku: product.sku,
    description: product.description,
    listPrice: product.price,
    unitPrice: options.unitPrice,
    priceSource: options.priceSource,
    bonusType,
    quantity,
    fromReservation: Boolean(options.fromReservation),
  });
}

function createCartLineKey(skuKey, fromReservation, unitPrice = 0, priceSource = "list", bonusType = "") {
  const normalizedSku = getSkuKey(skuKey);
  if (fromReservation) return `${normalizedSku}::reservation`;
  const normalizedPrice = roundMoney(Math.max(0, Number(unitPrice) || 0)).toFixed(2);
  return `${normalizedSku}::cash::${normalizePriceSource(priceSource)}::${normalizedPrice}::${normalizeBonusType(bonusType)}`;
}

function mergeCartLines(lines) {
  const merged = new Map();
  lines.forEach((line) => {
    const bonusType = normalizeBonusType(line.bonusType);
    const lineKey = createCartLineKey(line.skuKey, line.fromReservation, line.unitPrice, line.priceSource, bonusType);
    const existing = merged.get(lineKey);
    if (existing) {
      existing.quantity += line.quantity;
    } else {
      merged.set(lineKey, { ...line, bonusType, lineKey });
    }
  });
  return orderCartLines([...merged.values()]);
}

function orderCartLines(lines) {
  const groups = new Map();
  lines.forEach((line) => {
    const group = groups.get(line.skuKey) || [];
    group.push(line);
    groups.set(line.skuKey, group);
  });
  return [...groups.values()].flatMap((group) =>
    group.sort((a, b) => Number(b.fromReservation) - Number(a.fromReservation)),
  );
}

function shouldAskForCartCustomer() {
  return !customerConfirmedForCurrentCart || !cleanString(settings.customerName || dom.customerName.value);
}

function getProductPriceSource(product, unitPrice) {
  if (product.price > 0 && roundMoney(getDisplayDiscountPrice(product.price)) === roundMoney(unitPrice)) return "display";
  if (roundMoney(product.price) === roundMoney(unitPrice)) return "list";
  return "custom";
}

function openCartCustomerDialog(product, options = {}) {
  pendingCartProduct = product;
  pendingReservationChoiceTouched = false;
  const last = lastPrices[product.skuKey];
  pendingCartPriceSource = "list";
  dom.pendingProductSummary.textContent = `${product.sku || "ללא מק״ט"} · ${product.description || "ללא תיאור"}`;
  dom.cartProductQuantity.value = "1";
  dom.cartProductPrice.value = String(product.price);
  dom.cartProductPromotion.checked = Boolean(options.promotion);
  dom.cartCustomerInput.value = cleanString(settings.customerName || dom.customerName.value);
  renderCartCustomerFeedback();
  renderDialogQuickPrices(product, last);
  renderDialogReservationOption();
  updateDialogPromotionState();
  dom.cartCustomerDialog.hidden = false;
  document.body.classList.add("dialog-open");
  window.setTimeout(() => {
    if (dom.cartCustomerInput.value) {
      dom.cartProductQuantity.focus();
      dom.cartProductQuantity.select();
    } else {
      dom.cartCustomerInput.focus();
    }
  }, 50);
}

function renderDialogQuickPrices(product, last) {
  const listButton = document.createElement("button");
  listButton.type = "button";
  listButton.textContent = `מחירון ${formatPrice(product.price)}`;
  listButton.addEventListener("click", () => {
    dom.cartProductPrice.value = String(product.price);
    pendingCartPriceSource = "list";
  });

  const buttons = [listButton];
  if (product.price > 0) {
    const displayButton = createDisplayDiscountButton(product.price);
    displayButton.addEventListener("click", () => {
      const basePrice = parsePrice(displayButton.dataset.displayBasePrice) ?? product.price;
      dom.cartProductPrice.value = String(getDisplayDiscountPrice(basePrice));
      pendingCartPriceSource = "display";
    });
    buttons.push(displayButton);
  }
  if (Number.isFinite(last?.price)) {
    buttons.push(createLastPriceReference(last.price));
  }
  dom.cartProductQuickPrices.replaceChildren(...buttons);
}

function closeCartCustomerDialog() {
  pendingCartProduct = null;
  dom.cartCustomerDialog.hidden = true;
  dom.cartCustomerInput.value = "";
  dom.cartProductQuantity.value = "1";
  dom.cartProductQuantity.disabled = false;
  dom.cartProductPrice.value = "";
  dom.cartProductQuickPrices.replaceChildren();
  dom.cartProductPromotion.checked = false;
  dom.dialogPromotionOption.hidden = false;
  dom.cartProductReservation.checked = false;
  dom.dialogReservationOption.hidden = true;
  dom.cartProductPriceLabel.textContent = "מחיר ליחידה";
  pendingReservationChoiceTouched = false;
  dom.cartCustomerFeedback.textContent = "";
  document.body.classList.remove("dialog-open");
}

function confirmCartCustomer(event) {
  event.preventDefault();
  const customerName = cleanString(dom.cartCustomerInput.value);
  if (!customerName) {
    dom.cartCustomerFeedback.textContent = "צריך לבחור או להקליד לקוח.";
    dom.cartCustomerInput.focus();
    return;
  }

  const customer = findCustomerByName(customerName);
  if (orderType === "reservation" && !customer) {
    dom.cartCustomerFeedback.textContent = "לרכישה לשריון צריך לבחור לקוח קיים מרשימת הלקוחות.";
    dom.cartCustomerInput.focus();
    return;
  }
  if (customer) {
    applyCustomerToDraft(customer);
  } else {
    settings.customerId = "";
    settings.customerName = customerName;
    dom.customerName.value = customerName;
  }

  customerConfirmedForCurrentCart = true;
  saveSettings();
  renderCustomerHint();
  const product = pendingCartProduct;
  const quantity = parseQuantity(dom.cartProductQuantity.value);
  const fromReservation = orderType === "delivery" && dom.cartProductReservation.checked;
  const unitPrice = Math.max(0, parsePrice(dom.cartProductPrice.value) ?? product?.price ?? 0);
  const priceSource = pendingCartPriceSource;
  const usePromotion = dom.cartProductPromotion.checked && !dom.dialogPromotionOption.hidden;
  closeCartCustomerDialog();
  if (!product) return;
  if (usePromotion) {
    addTenPlusOneToCart(product, { unitPrice, priceSource });
  } else {
    addProductToCart(product, { quantity, unitPrice, priceSource, fromReservation });
  }
}

function renderDialogReservationOption() {
  const customer = findCustomerByName(dom.cartCustomerInput.value);
  const reservation = pendingCartProduct ? getCustomerReservation(customer, pendingCartProduct.skuKey) : null;
  const available = reservation?.quantity || 0;
  if (dom.cartProductPromotion.checked) {
    dom.dialogReservationOption.hidden = true;
    dom.cartProductReservation.checked = false;
    updateDialogReservationPricing();
    return;
  }
  dom.dialogReservationOption.hidden = orderType === "reservation" || available <= 0;
  dom.dialogReservationLabel.textContent = `מהשריון · נותרו ${available.toLocaleString("he-IL")} יח׳`;
  if (orderType === "reservation" || available <= 0) {
    dom.cartProductReservation.checked = false;
  } else if (!pendingReservationChoiceTouched) {
    dom.cartProductReservation.checked = true;
  }
  updateDialogReservationPricing();
}

function updateDialogReservationPricing() {
  const fromReservation = dom.cartProductReservation.checked && !dom.dialogReservationOption.hidden;
  dom.cartProductPrice.disabled = false;
  dom.cartProductQuickPrices.hidden = false;
  dom.cartProductPriceLabel.textContent = fromReservation ? "מחיר ליתרה מעבר לשריון" : "מחיר ליחידה";
}

function refreshDialogDisplayDiscountPrice() {
  const displayButton = dom.cartProductQuickPrices.querySelector(".display-discount-button");
  if (!displayButton) return;
  setDisplayDiscountButtonPrice(displayButton, parsePrice(dom.cartProductPrice.value) ?? 0);
}

function updateDialogPromotionState() {
  // The promotion is valid both for a regular delivery and for a purchase that
  // is recorded into a customer's reservation balance.
  const allowPromotion = true;
  dom.dialogPromotionOption.hidden = !allowPromotion;
  if (!allowPromotion) dom.cartProductPromotion.checked = false;
  const promotionSelected = allowPromotion && dom.cartProductPromotion.checked;
  if (promotionSelected) {
    dom.cartProductQuantity.value = "10";
    dom.cartProductQuantity.disabled = true;
    dom.cartProductReservation.checked = false;
    dom.dialogReservationOption.hidden = true;
    updateDialogReservationPricing();
  } else {
    dom.cartProductQuantity.disabled = false;
    renderDialogReservationOption();
  }
}

function renderCartCustomerFeedback() {
  const value = cleanString(dom.cartCustomerInput.value);
  if (!value) {
    dom.cartCustomerFeedback.textContent = "";
    return;
  }

  const customer = findCustomerByName(value);
  if (!customer) {
    dom.cartCustomerFeedback.textContent =
      orderType === "reservation" ? "לשריון צריך לקוח קיים." : "לא נמצא ברשימת הלקוחות.";
    return;
  }

  const details = [customer.code ? `קוד ${customer.code}` : "", customer.phone].filter(Boolean).join(" · ");
  dom.cartCustomerFeedback.textContent = details ? `נבחר: ${details}` : "לקוח קיים.";
}

function updateCartLine(lineKey, patch, options = { render: true }) {
  const updatedLines = cart
    .map((line) => {
      if (line.lineKey !== lineKey) return line;
      return {
        ...line,
        quantity: patch.quantity === undefined ? line.quantity : parseQuantity(patch.quantity),
        unitPrice: line.fromReservation
          ? 0
          : patch.unitPrice === undefined
            ? line.unitPrice
            : Math.max(0, Number(patch.unitPrice) || 0),
        priceSource: line.fromReservation
          ? "reservation"
          : patch.priceSource === undefined
            ? line.priceSource
            : normalizePriceSource(patch.priceSource),
      };
    })
    .filter((line) => line.quantity > 0);
  cart = options.rekey === false ? updatedLines : mergeCartLines(updatedLines);

  saveCart();
  if (options.render === false) {
    renderCartSummary();
  } else {
    renderCart();
  }
}

function removeCartLine(lineKey) {
  cart = cart.filter((line) => line.lineKey !== lineKey);
  if (!cart.length) {
    editingOrderId = "";
    editingDraftId = "";
    duplicatedOrderNeedsCustomer = false;
    orderReportTomorrow = false;
    orderReportToday = false;
    dom.saveAsDraft.checked = false;
    clearDraftCustomer();
    setOrderType("delivery", { render: false });
    saveOrderReportTomorrow();
    saveSettings();
  }
  saveCart();
  if (cart.length) {
    renderCart();
  } else {
    render();
  }
}

function clearCart() {
  cart = [];
  const wasEditingOrder = Boolean(editingOrderId);
  const wasEditingDraft = Boolean(editingDraftId);
  editingOrderId = "";
  editingDraftId = "";
  duplicatedOrderNeedsCustomer = false;
  orderReportTomorrow = false;
  orderReportToday = false;
  dom.saveAsDraft.checked = false;
  clearDraftCustomer();
  setOrderType("delivery", { render: false });
  saveCart();
  saveOrderReportTomorrow();
  saveSettings();
  render();
  dom.status.textContent = wasEditingDraft ? "עריכת הטיוטה בוטלה." : wasEditingOrder ? "עריכת ההזמנה בוטלה." : "הסל נוקה.";
}

function setOrderType(value, options = { render: true }) {
  const nextType = normalizeOrderType(value);
  if (nextType === orderType && options.render !== false) {
    renderCart();
    return;
  }
  orderType = nextType;
  if (orderType === "reservation" && cart.some((line) => line.fromReservation)) {
    const paidLineBySku = new Map(cart.filter((line) => !line.fromReservation).map((line) => [line.skuKey, line]));
    cart = mergeCartLines(
      cart.map((line) => {
        const paidLine = paidLineBySku.get(line.skuKey);
        return {
          ...line,
          fromReservation: false,
          unitPrice: paidLine?.unitPrice ?? line.listPrice,
          priceSource: paidLine?.priceSource || "list",
        };
      }),
    );
    saveCart();
  }
  localStorage.setItem(ORDER_TYPE_KEY, JSON.stringify(orderType));
  renderCustomerHint();
  if (options.render !== false) {
    render();
    dom.status.textContent =
      orderType === "reservation"
        ? "הסל הוגדר כרכישה לשריון. הכמויות יתווספו ליתרת הלקוח בשמירה."
        : "הסל הוגדר להזמנת אספקה רגילה.";
  }
}

function isReservationPurchaseOrder(order) {
  return normalizeOrderType(order?.orderType) === "reservation";
}

function saveDraftOrder(options = {}) {
  if (!cart.length) {
    dom.status.textContent = "אין פריטים בסל.";
    return null;
  }

  const now = new Date();
  const originalDraft = editingDraftId ? drafts.find((draft) => draft.id === editingDraftId) : null;
  if (editingDraftId && !originalDraft) editingDraftId = "";
  const customer = getSelectedCustomer();
  const customerName = customer?.name || cleanString(dom.customerName.value);
  if (duplicatedOrderNeedsCustomer && !customerName) {
    const message = "צריך לבחור לקוח חדש לטיוטה המשוכפלת.";
    dom.status.textContent = message;
    window.alert(message);
    dom.customerName.focus();
    return null;
  }
  if (orderType === "reservation" && !customer) {
    const message = "כדי לשמור טיוטה לשריון צריך לבחור לקוח קיים.";
    dom.status.textContent = message;
    window.alert(message);
    return null;
  }
  const reservationError = orderType === "delivery" ? validateReservationItems(customer, cart) : "";
  if (reservationError) {
    dom.status.textContent = reservationError;
    window.alert(reservationError);
    return null;
  }

  const createdAt = originalDraft?.createdAt || now.toISOString();
  const draft = {
    id: originalDraft?.id || `draft-${now.getTime()}`,
    createdAt,
    updatedAt: originalDraft ? now.toISOString() : "",
    reportDate: getOrderReportDateForDraft(createdAt, orderReportTomorrow, orderReportToday),
    customerId: customer?.id || "",
    customerName,
    customerCode: customer?.code || "",
    customerPhone: customer?.phone || "",
    orderType,
    draftReminderDate: originalDraft?.draftReminderDate || "",
    items: cart.map((line) => ({
      ...line,
      lineTotal: roundMoney(line.quantity * line.unitPrice),
    })),
  };
  draft.total = getOrderTotal(draft.items);

  drafts = originalDraft
    ? drafts.map((item) => (item.id === draft.id ? draft : item)).sort(compareOrdersByCreatedAt)
    : [draft, ...drafts.filter((item) => item.id !== draft.id)];
  cart = [];
  editingOrderId = "";
  editingDraftId = "";
  duplicatedOrderNeedsCustomer = false;
  orderReportTomorrow = false;
  orderReportToday = false;
  dom.saveAsDraft.checked = false;
  clearDraftCustomer();
  setOrderType("delivery", { render: false });
  saveDrafts();
  saveCart();
  saveSettings();
  saveOrderReportTomorrow();
  render();
  if (options.activateTab !== false) setActiveTab("drafts");
  dom.status.textContent =
    options.status ||
    (originalDraft
      ? "השינויים בטיוטה נשמרו. היא עדיין לא נכנסה להזמנות ולא עדכנה שריונים."
      : "הטיוטה נשמרה. היא לא נכנסה להזמנות ולא עדכנה שריונים.");
  return draft;
}

function saveOrder(options = {}) {
  if (!cart.length) {
    dom.status.textContent = "אין פריטים בסל.";
    return null;
  }

  const now = new Date();
  const originalOrder = editingOrderId ? orders.find((order) => order.id === editingOrderId) : null;
  if (editingOrderId && !originalOrder) editingOrderId = "";
  const customer = getSelectedCustomer();
  const customerName = customer?.name || cleanString(dom.customerName.value);
  if (duplicatedOrderNeedsCustomer && !customerName) {
    const message = "צריך לבחור לקוח חדש להזמנה המשוכפלת.";
    dom.status.textContent = message;
    window.alert(message);
    dom.customerName.focus();
    return null;
  }
  if (orderType === "reservation" && !customer) {
    const message = "כדי להוסיף הזמנה לשריון צריך לבחור לקוח קיים.";
    dom.status.textContent = message;
    window.alert(message);
    return null;
  }
  const reservationError = orderType === "delivery" ? validateReservationItems(customer, cart, originalOrder) : "";
  if (reservationError) {
    dom.status.textContent = reservationError;
    window.alert(reservationError);
    return null;
  }
  const createdAt = originalOrder?.createdAt || now.toISOString();
  const order = {
    id: originalOrder?.id || `order-${now.getTime()}`,
    createdAt,
    updatedAt: originalOrder ? now.toISOString() : "",
    completedAt: cleanString(originalOrder?.completedAt),
    reportDate: getOrderReportDateForDraft(createdAt, orderReportTomorrow, orderReportToday),
    customerId: customer?.id || "",
    customerName,
    customerCode: customer?.code || "",
    customerPhone: customer?.phone || "",
    orderType,
    items: cart.map((line) => ({
      ...line,
      lineTotal: roundMoney(line.quantity * line.unitPrice),
    })),
  };
  order.total = getOrderTotal(order.items);

  if (originalOrder && isReservationPurchaseOrder(originalOrder) && isReservationPurchaseOrder(order)) {
    reconcileReservationPurchaseOrder(originalOrder, order);
  } else {
    if (originalOrder) removeOrderReservationEffects(originalOrder);
    applyOrderReservationEffects(order);
  }

  orders = originalOrder
    ? orders.map((existingOrder) => (existingOrder.id === originalOrder.id ? order : existingOrder))
    : [order, ...orders];
  lastPrices = rebuildLastPricesFromOrders(orders);
  cart = [];
  editingOrderId = "";
  editingDraftId = "";
  duplicatedOrderNeedsCustomer = false;
  orderReportTomorrow = false;
  orderReportToday = false;
  dom.saveAsDraft.checked = false;
  clearDraftCustomer();
  setOrderType("delivery", { render: false });
  saveOrders();
  saveReservations({ sync: false });
  saveLastPrices();
  saveCart();
  saveSettings();
  saveOrderReportTomorrow();
  render();
  queueCloudSave();
  if (options.activateTab !== false) setActiveTab("orders");
  dom.status.textContent =
    options.status ||
    (originalOrder
      ? "השינויים בהזמנה נשמרו והמלאי המשוריין עודכן."
      : isReservationPurchaseOrder(order)
        ? "הזמנת השריון נשמרה ויתרות הלקוח עודכנו."
        : "ההזמנה נשמרה והמלאי המשוריין עודכן.");
  return order;
}

function addOrderToReservations(order) {
  const customer = getOrderCustomer(order) || customers.find((item) => item.id === order.customerId);
  if (!customer) return;
  order.items.forEach((line) => {
    adjustReservationBalance(customer, line, parseQuantity(line.quantity), order.createdAt);
  });
  sortReservations();
}

function applyOrderReservationEffects(order) {
  if (isReservationPurchaseOrder(order)) {
    addOrderToReservations(order);
  } else {
    deductOrderReservations(order);
  }
}

function removeOrderReservationEffects(order) {
  if (isReservationPurchaseOrder(order)) {
    reverseReservationPurchase(order);
  } else {
    restoreOrderReservations(order);
  }
}

function reconcileReservationPurchaseOrder(originalOrder, nextOrder) {
  const originalCustomer = getOrderCustomer(originalOrder) || customers.find((item) => item.id === originalOrder.customerId);
  const nextCustomer = getOrderCustomer(nextOrder) || customers.find((item) => item.id === nextOrder.customerId);
  if (!isSameCustomerRecord(originalCustomer, nextCustomer)) {
    removeOrderReservationEffects(originalOrder);
    applyOrderReservationEffects(nextOrder);
    return;
  }

  const customer = nextCustomer || originalCustomer;
  if (!customer) return;
  const timestamp = nextOrder.updatedAt || nextOrder.createdAt || new Date().toISOString();
  const originalItems = groupOrderItemsBySku(originalOrder.items);
  const nextItems = groupOrderItemsBySku(nextOrder.items);
  const skuKeys = new Set([...originalItems.keys(), ...nextItems.keys()]);

  skuKeys.forEach((skuKey) => {
    const originalItem = originalItems.get(skuKey);
    const nextItem = nextItems.get(skuKey);
    const delta = (nextItem?.quantity || 0) - (originalItem?.quantity || 0);
    if (!delta) return;
    adjustReservationBalance(customer, nextItem?.line || originalItem?.line, delta, timestamp);
  });
  sortReservations();
}

function groupOrderItemsBySku(items) {
  return items.reduce((grouped, line) => {
    const skuKey = line.skuKey || getSkuKey(line.sku);
    if (!skuKey) return grouped;
    const current = grouped.get(skuKey) || { quantity: 0, line: { ...line, skuKey } };
    current.quantity += parseQuantity(line.quantity);
    current.line = { ...current.line, ...line, skuKey };
    grouped.set(skuKey, current);
    return grouped;
  }, new Map());
}

function isSameCustomerRecord(first, second) {
  if (!first || !second) return false;
  if (first.id && second.id) return first.id === second.id;
  return normalizeSearch(first.name) === normalizeSearch(second.name);
}

function adjustReservationBalance(customer, line, delta, timestamp = new Date().toISOString()) {
  if (!customer || !line || !delta) return 0;
  const skuKey = line.skuKey || getSkuKey(line.sku);
  if (!skuKey) return 0;
  let reservation = getCustomerReservation(customer, skuKey);
  if (!reservation && delta > 0) {
    reservation = {
      id: createReservationId(customer.id, skuKey),
      customerId: customer.id,
      customerName: customer.name,
      skuKey,
      sku: line.sku || skuKey,
      description: line.description || "",
      quantity: 0,
      updatedAt: timestamp,
    };
    reservations.push(reservation);
  }
  if (!reservation) return 0;

  const currentQuantity = parseNonNegativeInteger(reservation.quantity);
  if (delta > 0) {
    reservation.quantity = currentQuantity + delta;
  } else {
    const decrease = Math.abs(delta);
    reservation.quantity = Math.max(0, currentQuantity - decrease);
  }
  reservation.updatedAt = timestamp;
  return reservation.quantity - currentQuantity;
}

function sortReservations() {
  reservations.sort(
    (a, b) => a.customerName.localeCompare(b.customerName, "he") || a.sku.localeCompare(b.sku, "en"),
  );
}

function validateReservationItems(customer, items, originalOrder = null) {
  const reservedItems = items.filter((line) => line.fromReservation);
  if (!reservedItems.length) return "";
  if (!customer) return "כדי להשתמש בשריון צריך לבחור לקוח קיים.";

  for (const line of reservedItems) {
    const reservation = getCustomerReservation(customer, line.skuKey);
    const editAllowance = getOrderReservationAllowance(originalOrder, customer, line.skuKey);
    const available = (reservation?.quantity || 0) + editAllowance;
    if (!available) return `אין ללקוח שריון פעיל עבור ${line.sku}.`;
    if (line.quantity > available) {
      return `בשריון של ${line.sku} נותרו ${available.toLocaleString("he-IL")} יחידות בלבד.`;
    }
  }
  return "";
}

function getEditingReservationAllowance(customer, skuKey) {
  const originalOrder = editingOrderId ? orders.find((order) => order.id === editingOrderId) : null;
  return getOrderReservationAllowance(originalOrder, customer, skuKey);
}

function getOrderReservationAllowance(order, customer, skuKey) {
  if (!order || !customer || isReservationPurchaseOrder(order)) return 0;
  const orderCustomer = getOrderCustomer(order);
  const sameCustomer = orderCustomer?.id && customer.id
    ? orderCustomer.id === customer.id
    : normalizeSearch(orderCustomer?.name || order.customerName) === normalizeSearch(customer.name);
  if (!sameCustomer) return 0;
  return order.items
    .filter((line) => line.fromReservation && line.skuKey === skuKey)
    .reduce((sum, line) => sum + line.quantity, 0);
}

function deductOrderReservations(order) {
  const customer = getOrderCustomer(order) || customers.find((item) => item.id === order.customerId);
  order.items.forEach((line) => {
    if (!line.fromReservation) return;
    adjustReservationBalance(customer, line, -parseQuantity(line.quantity), order.createdAt);
  });
}

function restoreOrderReservations(order) {
  const customer = getOrderCustomer(order) || customers.find((item) => item.id === order.customerId);
  if (!customer) return;
  order.items.forEach((line) => {
    if (!line.fromReservation) return;
    adjustReservationBalance(customer, line, parseQuantity(line.quantity));
  });
  sortReservations();
}

function sendCurrentOrderToWhatsApp(event) {
  const url = createWhatsAppUrl(cart);
  if (!url) {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  if (editingDraftId || dom.saveAsDraft.checked) {
    const draft = saveDraftOrder({
      status: "הטיוטה נשמרה וההודעה נפתחה בוואטסאפ. היא לא נכנסה להזמנות.",
    });
    if (!draft) return;
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const status =
    orderType === "reservation"
      ? "הזמנת השריון נשמרה, היתרות עודכנו וההודעה נפתחה בוואטסאפ."
      : "ההזמנה נשמרה ונפתחה לשליחה בוואטסאפ.";
  const order = saveOrder({ status });
  if (!order) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function renderCart() {
  const isReservationPurchase = orderType === "reservation";
  const isEditingOrder = Boolean(editingOrderId);
  const isEditingDraft = Boolean(editingDraftId);
  dom.cartPanel.classList.toggle("reservation-purchase-cart", isReservationPurchase);
  dom.cartPanel.classList.toggle("editing-order-cart", isEditingOrder);
  dom.cartPanel.classList.toggle("editing-draft-cart", isEditingDraft);
  dom.cartTitle.textContent = isEditingDraft
    ? "עריכת טיוטה"
    : isEditingOrder
    ? "עריכת הזמנה"
    : isReservationPurchase
      ? "הזמנה חדשה לשריון"
      : "הזמנה נוכחית";
  const saveAsDraft = dom.saveAsDraft.checked;
  dom.saveOrder.textContent = isEditingDraft || saveAsDraft
    ? "שמור טיוטה"
    : isEditingOrder
    ? "שמור שינויים"
    : isReservationPurchase
      ? "שמור והוסף לשריון"
      : "שמור הזמנה";
  dom.clearCart.textContent = isEditingDraft ? "בטל עריכת טיוטה" : isEditingOrder ? "בטל עריכה" : "נקה סל";
  dom.orderTypeInputs.forEach((input) => {
    input.checked = input.value === orderType;
  });
  dom.reportTomorrow.checked = orderReportTomorrow;
  dom.reportToday.checked = orderReportToday;
  renderCartSummary();

  if (!cart.length) {
    const customerName = cleanString(settings.customerName || dom.customerName.value);
    dom.cartItems.replaceChildren(customerName ? renderEmptyCartAction(customerName) : emptyState("אין פריטים בסל."));
  } else {
    dom.cartItems.replaceChildren(...cart.map(renderCartLine));
  }
}

function renderEmptyCartAction(customerName) {
  const node = document.createElement("div");
  node.className = "empty-cart-action";
  const label = document.createElement("strong");
  label.textContent = `${orderType === "reservation" ? "הזמנה לשריון" : "הזמנה"} עבור ${customerName}`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "file-button";
  button.dataset.addCartItems = "";
  button.textContent = "הוסף פריטים";
  node.append(label, button);
  return node;
}

function renderCartSummary() {
  const total = getOrderTotal(cart);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  dom.cartSummary.textContent = itemCount === 1 ? "פריט אחד" : `${itemCount.toLocaleString("he-IL")} פריטים`;
  dom.cartTotal.textContent = `סה״כ ${formatPrice(total)}`;
  renderFloatingCart(total, itemCount);

  const url = createWhatsAppUrl(cart);
  updateWhatsAppLink(dom.sendWhatsApp, url);
}

function renderFloatingCart(total = getOrderTotal(cart), itemCount = cart.reduce((sum, line) => sum + line.quantity, 0)) {
  const hasItems = itemCount > 0;
  dom.floatingCart.hidden = !hasItems || activeTab === "cart";
  dom.floatingCartCount.textContent = itemCount.toLocaleString("he-IL");
  dom.floatingCartTotal.textContent = formatPrice(total);
  dom.floatingCart.setAttribute(
    "aria-label",
    hasItems ? `פתח סל עם ${itemCount.toLocaleString("he-IL")} פריטים, סך הכל ${formatPrice(total)}` : "פתח סל הזמנה",
  );
}

function renderCartLine(line) {
  const last = lastPrices[line.skuKey];
  const selectedCustomer = getSelectedCustomer();
  const reservation = getCustomerReservation(selectedCustomer, line.skuKey);
  const reservationAvailable = (reservation?.quantity || 0) + getEditingReservationAllowance(selectedCustomer, line.skuKey);
  const row = document.createElement("article");
  row.className = "cart-line";
  row.classList.toggle("reservation-cart-line", Boolean(line.fromReservation));
  row.classList.toggle("bonus-cart-line", isBonusOrderItem(line));

  const header = document.createElement("div");
  header.className = "cart-line-header";

  const title = document.createElement("div");
  title.className = "cart-line-title";
  title.innerHTML = `<strong>${escapeHtml(line.sku)}</strong><span>${escapeHtml(line.description)}</span>`;

  const remove = document.createElement("button");
  remove.className = "icon-text-button";
  remove.type = "button";
  remove.dataset.removeCart = line.lineKey;
  remove.textContent = "הסר";

  const controls = document.createElement("div");
  controls.className = "cart-controls";

  const quantity = createNumberField("כמות", line.quantity, {
    min: 1,
    step: 1,
    attr: "cartQuantity",
    key: line.lineKey,
  });
  const price = line.fromReservation
    ? createReservationPriceField()
    : isBonusOrderItem(line)
      ? createBonusPriceField(line)
      : createNumberField("מחיר יחידה", line.unitPrice, {
        min: 0,
        step: 0.01,
        attr: "cartPrice",
        key: line.lineKey,
      });

  const quickPrices = document.createElement("div");
  quickPrices.className = "quick-prices";

  if (!line.fromReservation && !isBonusOrderItem(line)) {
    const listButton = document.createElement("button");
    listButton.type = "button";
    listButton.dataset.useListPrice = line.lineKey;
    listButton.textContent = `מחירון ${formatPrice(line.listPrice)}`;
    quickPrices.append(listButton);

    if (line.listPrice > 0) {
      const displayButton = createDisplayDiscountButton(line.listPrice);
      displayButton.dataset.useDisplayPrice = line.lineKey;
      displayButton.classList.toggle("active", line.priceSource === "display");
      displayButton.setAttribute("aria-pressed", String(line.priceSource === "display"));
      quickPrices.append(displayButton);
    }

    if (Number.isFinite(last?.price)) {
      quickPrices.append(createLastPriceReference(last.price));
    }
  }

  const reservationBadge = document.createElement("div");
  reservationBadge.className = "reservation-cart-badge";
  reservationBadge.textContent = `מהשריון · זמינות ${reservationAvailable.toLocaleString("he-IL")} יח׳ להזמנה`;
  reservationBadge.hidden = !line.fromReservation;

  const displayBadge = document.createElement("div");
  displayBadge.className = "display-discount-badge";
  displayBadge.textContent = "פריט תצוגה · 15% הנחה";
  displayBadge.hidden = line.priceSource !== "display";

  const bonusBadge = document.createElement("div");
  bonusBadge.className = "bonus-cart-badge";
  bonusBadge.textContent = `${getBonusOrderItemLabel(line)} · יחידה ללא עלות`;
  bonusBadge.hidden = !isBonusOrderItem(line);

  header.append(title, remove);
  controls.append(quantity, price);
  row.append(header, controls, reservationBadge, displayBadge, bonusBadge, quickPrices);
  return row;
}

function createDisplayDiscountButton(listPrice) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "display-discount-button";
  setDisplayDiscountButtonPrice(button, listPrice);
  return button;
}

function setDisplayDiscountButtonPrice(button, basePrice) {
  const price = Math.max(0, parsePrice(basePrice) ?? 0);
  const discountedPrice = getDisplayDiscountPrice(price);
  button.dataset.displayBasePrice = String(price);
  button.textContent = `תצוגה -15% · ${formatPrice(discountedPrice)}`;
  button.setAttribute("aria-label", `החל הנחת תצוגה של 15 אחוז ממחיר ${formatPrice(price)}, מחיר ${formatPrice(discountedPrice)}`);
}

function createLastPriceReference(lastPrice) {
  const reference = document.createElement("span");
  reference.className = "last-price-reference";
  reference.textContent = `מחיר אחרון לצפייה: ${formatPrice(lastPrice)}`;
  return reference;
}

function getDisplayDiscountPrice(listPrice) {
  return roundMoney(Math.max(0, Number(listPrice) || 0) * (1 - DISPLAY_DISCOUNT_RATE));
}

function createReservationPriceField() {
  const field = document.createElement("div");
  field.className = "field-wrap compact-field reservation-price-field";
  field.innerHTML = "<span>מחיר יחידה</span><strong>משריון</strong>";
  return field;
}

function createBonusPriceField(line) {
  const field = document.createElement("div");
  field.className = "field-wrap compact-field bonus-price-field";
  field.innerHTML = `<span>מחיר יחידה</span><strong>₪0 · ${escapeHtml(getBonusOrderItemLabel(line))}</strong>`;
  return field;
}

function renderOrders() {
  const query = normalizeSearch(dom.orderSearch.value);
  const openOrders = orders.filter((order) => !isOrderCompleted(order) && !isOrderForTomorrow(order));
  const visibleOrders = filterOrdersByQuery(openOrders, query).sort(compareOrdersByCreatedAt);

  if (!visibleOrders.length) {
    dom.ordersList.replaceChildren(emptyState(query ? "לא נמצאו הזמנות פתוחות מתאימות." : "אין הזמנות פתוחות כרגע."));
    return;
  }

  dom.ordersList.replaceChildren(
    ...visibleOrders.slice(0, query ? 60 : 80).map((order) => renderOrderCard(order, { tone: "orders-history-card" })),
  );
}

function renderCompletedOrders() {
  const query = normalizeSearch(dom.completedOrderSearch.value);
  const completedOrders = orders.filter(isOrderCompleted);
  const visibleOrders = filterOrdersByQuery(completedOrders, query).sort(compareOrdersByCreatedAt);

  if (!visibleOrders.length) {
    dom.completedOrdersList.replaceChildren(emptyState(query ? "לא נמצאו הזמנות שהושלמו מתאימות." : "אין עדיין הזמנות שהושלמו."));
    return;
  }

  dom.completedOrdersList.replaceChildren(
    ...visibleOrders.slice(0, query ? 80 : 120).map((order) => renderOrderCard(order, { tone: "completed-order-card" })),
  );
}

function renderTomorrowOrders() {
  const query = normalizeSearch(dom.tomorrowOrderSearch.value);
  const reportDateFilter = normalizeDateInput(tomorrowOrdersReportDateFilter);
  const tomorrowOrders = reportDateFilter
    ? orders.filter((order) => !isOrderCompleted(order) && getOrderReportDateKey(order) === reportDateFilter)
    : orders.filter((order) => !isOrderCompleted(order) && isOrderForTomorrow(order));
  const visibleOrders = filterOrdersByQuery(tomorrowOrders, query).sort(compareOrdersByCreatedAt);
  const isSundayView = Boolean(reportDateFilter);
  if (dom.tomorrowOrdersEyebrow) dom.tomorrowOrdersEyebrow.textContent = isSundayView ? "דוחות יום ראשון" : "דוחות מחר";
  if (dom.tomorrowOrdersTitle) dom.tomorrowOrdersTitle.textContent = isSundayView ? "הזמנות פתוחות ליום ראשון" : "הזמנות למחר";
  if (dom.tomorrowOrdersChip) dom.tomorrowOrdersChip.textContent = isSundayView ? formatSundayOrderDate(reportDateFilter) : "מוכן לאספקה";
  if (dom.tomorrowOrdersSearchLabel) dom.tomorrowOrdersSearchLabel.textContent = isSundayView ? "חיפוש בהזמנות ליום ראשון" : "חיפוש בהזמנות למחר";

  if (!visibleOrders.length) {
    dom.tomorrowOrdersList.replaceChildren(
      emptyState(query ? `לא נמצאו ${isSundayView ? "הזמנות ליום ראשון" : "הזמנות למחר"} שמתאימות לחיפוש.` : isSundayView ? "אין הזמנות פתוחות ליום ראשון." : "אין הזמנות שמדווחות למחר."),
    );
    return;
  }

  dom.tomorrowOrdersList.replaceChildren(
    ...visibleOrders.slice(0, query ? 60 : 80).map((order) => renderOrderCard(order, { tone: "tomorrow-order-card" })),
  );
}

function filterOrdersByQuery(orderList, query) {
  return orderList.filter((order) => {
    if (!query) return true;
    const searchable = [
      order.customerName,
      getOrderCustomer(order)?.name,
      ...order.items.flatMap((item) => [item.sku, item.description]),
    ].join(" ");
    return normalizeSearch(searchable).includes(query);
  });
}

function renderDrafts() {
  const query = normalizeSearch(dom.draftSearch.value);
  const visibleDrafts = drafts.filter((draft) => {
    if (!query) return true;
    const searchable = [
      draft.customerName,
      draft.customerCode,
      draft.customerPhone,
      getOrderCustomer(draft)?.name,
      ...draft.items.flatMap((item) => [item.sku, item.description]),
    ].join(" ");
    return normalizeSearch(searchable).includes(query);
  }).sort(compareOrdersByCreatedAt);

  dom.draftsSummary.textContent = query
    ? `${visibleDrafts.length.toLocaleString("he-IL")} מתוך ${drafts.length.toLocaleString("he-IL")}`
    : drafts.length === 1
      ? "טיוטה אחת"
      : `${drafts.length.toLocaleString("he-IL")} טיוטות`;
  if (!drafts.length) {
    dom.draftsList.replaceChildren(emptyState("אין טיוטות שמורות."));
    return;
  }
  if (!visibleDrafts.length) {
    dom.draftsList.replaceChildren(emptyState("לא נמצאו טיוטות מתאימות."));
    return;
  }

  dom.draftsList.replaceChildren(...visibleDrafts.slice(0, query ? 80 : 20).map(renderDraftCard));
}

function renderDraftCard(draft) {
  const card = document.createElement("article");
  card.className = "order-card draft-card";
  card.classList.toggle("reservation-purchase-order", isReservationPurchaseOrder(draft));
  const customer = getOrderCustomer(draft);
  const customerName = customer?.name || draft.customerName;
  const createdAt = formatShortDateTime(draft.createdAt);
  const itemCount = draft.items.reduce((sum, item) => sum + item.quantity, 0);
  const summary = draft.items
    .slice(0, 2)
    .map((item) => `${item.description} × ${item.quantity}`)
    .join(" · ");

  const body = document.createElement("div");
  body.className = "order-body";
  body.innerHTML = `
    <strong>${escapeHtml(createdAt)}</strong>
    <span class="draft-badge">טיוטה</span>
    ${isReservationPurchaseOrder(draft) ? '<span class="order-type-badge">הזמנה לשריון</span>' : ""}
    ${customerName ? `<span>לקוח: ${escapeHtml(customerName)}</span>` : ""}
    ${draft.draftReminderDate ? `<span class="draft-reminder-badge">תזכורת: ${escapeHtml(formatReminderDate(draft.draftReminderDate))}</span>` : ""}
    <span>${itemCount.toLocaleString("he-IL")} יח׳ · ${escapeHtml(formatPrice(draft.total))}</span>
    <small>${escapeHtml(summary)}</small>
    <label class="field-wrap compact-field draft-date-control">
      <span>תאריך להוצאת הזמנה</span>
      <input type="date" data-draft-reminder-date="${escapeHtml(draft.id)}" value="${escapeHtml(draft.draftReminderDate || "")}" />
    </label>
    <div class="draft-date-actions">
      <button class="secondary-button" type="button" data-save-draft-reminder-date="${escapeHtml(draft.id)}">שמור תאריך</button>
    </div>
  `;

  const actions = document.createElement("div");
  actions.className = "order-actions draft-actions";
  actions.innerHTML = `
    <button class="file-button" type="button" data-commit-draft="${escapeHtml(draft.id)}">הכנס להזמנות</button>
    <button class="whatsapp-button compact" type="button" data-send-draft-whatsapp="${escapeHtml(draft.id)}">וואטסאפ</button>
    <button class="secondary-button" type="button" data-edit-draft="${escapeHtml(draft.id)}">ערוך</button>
    <button class="secondary-button" type="button" data-load-draft="${escapeHtml(draft.id)}">טען לסל</button>
    ${draft.draftReminderDate ? `<button class="secondary-button" type="button" data-clear-draft-reminder="${escapeHtml(draft.id)}">אפס תאריך</button>` : ""}
    <button class="secondary-button" type="button" data-toggle-draft-details="${escapeHtml(draft.id)}" aria-expanded="false">הצג טיוטה</button>
    <button class="danger-button" type="button" data-delete-draft="${escapeHtml(draft.id)}">מחק</button>
  `;

  const details = createOrderTextDetails(draft, { showReportDate: false });
  card.append(body, actions, details);
  return card;
}

function renderOrderCard(order, options = {}) {
  const card = document.createElement("article");
  card.className = "order-card";
  if (options.tone) card.classList.add(options.tone);
  card.classList.toggle("reservation-purchase-order", isReservationPurchaseOrder(order));
  const customer = getOrderCustomer(order);
  const customerName = customer?.name || order.customerName;
  const isTomorrowOrder = options.tone === "tomorrow-order-card";
  const isCompletedOrderCard = options.tone === "completed-order-card";
  const iconName = isReservationPurchaseOrder(order) ? "package" : isTomorrowOrder ? "calendar" : "receipt";
  const typeLabel = isReservationPurchaseOrder(order)
    ? "הזמנה לשריון"
    : isTomorrowOrder
      ? "אספקה למחר"
      : isCompletedOrderCard
        ? "הושלמה"
        : "הזמנה פתוחה";

  const date = new Date(order.createdAt).toLocaleString("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const reportLabel = getOrderReportLabel(order);
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const reservationUsage = getOrderReservationUsage(order);
  const summary = order.items
    .slice(0, 2)
    .map((item) => `${item.description} × ${item.quantity}`)
    .join(" · ");

  const body = document.createElement("div");
  body.className = "order-body";
  const customerLine = customerName
    ? `<div class="order-card-customer">${getOrderActionIcon("customer")}<span>${escapeHtml(customerName)}</span></div>`
    : "";
  body.innerHTML = `
    <div class="order-card-heading">
      <span class="order-card-kind-icon ${escapeHtml(iconName)}" aria-hidden="true">${getOrderActionIcon(iconName)}</span>
      <div class="order-card-heading-copy">
        <strong>${escapeHtml(date)}</strong>
        <span class="order-card-state">${escapeHtml(typeLabel)}</span>
      </div>
      <span class="order-card-verified" aria-label="הזמנה שמורה">${getOrderActionIcon("check")}</span>
    </div>
    ${isReservationPurchaseOrder(order) ? '<span class="order-type-badge">הזמנה לשריון</span>' : ""}
    ${reservationUsage ? `<span class="order-reservation-badge ${reservationUsage.partial ? "partial" : "full"}">${getOrderActionIcon("package")}<span>${reservationUsage.label}</span></span>` : ""}
    ${customerLine}
    ${reportLabel ? `<span class="order-report-badge">${escapeHtml(reportLabel)}</span>` : ""}
    <div class="order-card-totals"><span>${escapeHtml(itemCount.toLocaleString("he-IL"))} יח׳</span><b>${escapeHtml(formatPrice(order.total))}</b></div>
    <small class="order-card-summary">${escapeHtml(summary)}</small>
  `;

  const actions = createOrderActions(order, { showDetails: true });
  const details = createOrderTextDetails(order);
  card.append(body, actions, details);
  return card;
}

function getOrderReservationUsage(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const hasReservationItems = items.some((item) => isReservationOrderItem(item));
  if (!hasReservationItems) return null;

  const hasPaidItems = items.some((item) =>
    !isReservationOrderItem(item) && !isBonusOrderItem(item) && Math.max(0, Number(item?.unitPrice) || 0) > 0,
  );

  return hasPaidItems
    ? { label: "שריון חלקי", partial: true }
    : { label: "שריון", partial: false };
}

function createOrderActions(order, options = {}) {
  const actions = document.createElement("div");
  actions.className = "order-actions";

  const primaryAction = document.createElement("button");
  primaryAction.type = "button";
  primaryAction.className = "secondary-button order-action-button order-action-view";
  if (options.showDetails) {
    primaryAction.dataset.toggleOrderDetails = order.id;
    primaryAction.setAttribute("aria-expanded", "false");
    primaryAction.innerHTML = `${getOrderActionIcon("view")}<span>הצג הזמנה</span>`;
  } else {
    primaryAction.dataset.loadOrder = order.id;
    primaryAction.innerHTML = `${getOrderActionIcon("load")}<span>טען לסל</span>`;
  }

  const whatsapp = document.createElement("a");
  whatsapp.className = "whatsapp-button compact order-action-button order-action-whatsapp";
  whatsapp.target = "_blank";
  whatsapp.rel = "noreferrer";
  whatsapp.innerHTML = `${getOrderActionIcon("whatsapp")}<span>וואטסאפ</span>`;
  updateWhatsAppLink(whatsapp, createWhatsAppUrl(order.items, order));

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary-button order-action-button order-action-edit";
  edit.dataset.editOrder = order.id;
  edit.innerHTML = `${getOrderActionIcon("edit")}<span>ערוך</span>`;

  const duplicate = document.createElement("button");
  duplicate.type = "button";
  duplicate.className = "secondary-button order-action-button order-action-copy";
  duplicate.dataset.duplicateOrder = order.id;
  duplicate.innerHTML = `${getOrderActionIcon("copy")}<span>שכפל</span>`;

  const moveToDraft = document.createElement("button");
  moveToDraft.type = "button";
  moveToDraft.className = "secondary-button order-action-button order-action-draft";
  moveToDraft.dataset.moveOrderToDraft = order.id;
  moveToDraft.innerHTML = `${getOrderActionIcon("draft")}<span>לטיוטות</span>`;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger-button order-action-button order-action-delete";
  remove.dataset.deleteOrder = order.id;
  remove.innerHTML = `${getOrderActionIcon("trash")}<span>מחק</span>`;

  actions.append(primaryAction, duplicate, edit);
  if (options.showDetails) actions.append(moveToDraft);
  actions.append(whatsapp, remove);
  return actions;
}

function getOrderActionIcon(name) {
  const paths = {
    receipt: '<path d="M6 3h12v18l-2.5-1.5L12 21l-3.5-1.5L6 21z" /><path d="M9 8h6M9 12h6M9 16h4" />',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h5" />',
    package: '<path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4V11M20 7v10l-8 4" />',
    check: '<path d="m5 12 4 4L19 6" />',
    customer: '<circle cx="12" cy="8" r="3" /><path d="M5 21a7 7 0 0 1 14 0" />',
    view: '<path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="2.4" />',
    load: '<path d="M12 3v11" /><path d="m8 10 4 4 4-4M5 19h14" />',
    copy: '<rect x="9" y="9" width="10" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />',
    edit: '<path d="m4 20 4.2-1 9.5-9.5a2.1 2.1 0 0 0-3-3L5.2 16 4 20z" /><path d="m13.5 7.5 3 3" />',
    draft: '<path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 15l5-5 2 2-5 5-3 1z" />',
    whatsapp: '<path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5z" /><path d="M9 9.1c.2 2 1.8 3.6 3.8 3.8l1.3-1.2 1.5.6c.2.1.3.4.2.6-.4.9-1.3 1.3-2.1 1.1-3.3-.8-5.8-3.3-6.6-6.6-.2-.9.2-1.8 1.1-2.1.2-.1.5 0 .6.2l.6 1.5z" />',
    trash: '<path d="M4 7h16M10 11v5M14 11v5M6 7l1 14h10l1-14M9 7V4h6v3" />',
    bonus: '<path d="m12 3 1.9 4.4L18.5 9l-3.4 3.2.9 4.8-4.1-2.4-4.1 2.4.9-4.8L5.5 9l4.6-1.6z" />',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.receipt}</svg>`;
}

function createOrderTextDetails(order, options = {}) {
  const details = document.createElement("div");
  details.className = "order-text-details";
  details.hidden = true;

  if (options.showReportDate !== false) {
    const reportDate = document.createElement("p");
    reportDate.className = "order-details-meta";
    reportDate.textContent = `תאריך הזמנה: ${formatReminderDate(getOrderReportDateKey(order))}`;
    details.append(reportDate);
  }

  if (isReservationPurchaseOrder(order)) {
    const type = document.createElement("strong");
    type.className = "order-details-type";
    type.textContent = "הזמנה לשריון";
    details.append(type);
  }

  order.items.forEach((item) => {
    const line = document.createElement("p");
    const orderLine = document.createElement("span");
    orderLine.textContent = formatOrderLine(item);
    line.append(orderLine);

    const shortDescription = getOrderItemShortDescription(item);
    if (shortDescription) {
      const description = document.createElement("small");
      description.className = "order-item-short-description";
      description.textContent = shortDescription;
      line.append(description);
    }
    details.append(line);
  });

  const total = document.createElement("strong");
  total.textContent = `סה״כ הזמנה: ${formatPlainPrice(order.total)} ש״ח`;
  details.append(total);
  return details;
}

function createNumberField(labelText, value, options) {
  const label = document.createElement("label");
  label.className = "field-wrap compact-field";
  const labelNode = document.createElement("span");
  labelNode.textContent = labelText;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(options.min);
  input.step = String(options.step);
  input.value = String(value);
  input.dataset[options.attr] = options.key;
  label.append(labelNode, input);
  return label;
}

function createQuantitySelectField(labelText, value, options) {
  const label = document.createElement("label");
  label.className = "field-wrap compact-field";
  const labelNode = document.createElement("span");
  labelNode.textContent = labelText;
  const select = document.createElement("select");
  const quantities = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100];
  const selected = parseQuantity(value);
  quantities.forEach((quantity) => {
    const option = document.createElement("option");
    option.value = String(quantity);
    option.textContent = String(quantity);
    option.selected = quantity === selected;
    select.append(option);
  });
  if (!quantities.includes(selected)) {
    const option = document.createElement("option");
    option.value = String(selected);
    option.textContent = String(selected);
    option.selected = true;
    select.append(option);
  }
  select.dataset[options.attr] = options.key;
  label.append(labelNode, select);
  return label;
}

function createWhatsAppUrl(items, order = null) {
  const phone = normalizePhone(settings.whatsappNumber);
  if (!phone || !items.length) return "";
  return `https://wa.me/${phone}?text=${encodeURIComponent(createOrderMessage(items, order))}`;
}

function updateWhatsAppLink(link, url) {
  if (!url) {
    link.href = "#";
    link.classList.add("disabled");
    link.setAttribute("aria-disabled", "true");
    return;
  }

  link.href = url;
  link.classList.remove("disabled");
  link.removeAttribute("aria-disabled");
}

function createOrderMessage(items, order = null) {
  const lines = [];
  const orderCustomer = order ? getOrderCustomer(order) : getSelectedCustomer();
  const customerName = cleanString(orderCustomer?.name || order?.customerName || dom.customerName.value);
  const reservationPurchase = order ? isReservationPurchaseOrder(order) : orderType === "reservation";
  const title = reservationPurchase ? "הזמנה לשריון" : "הזמנה";
  lines.push(customerName ? `${title} - ${customerName}` : title);
  lines.push("");
  [...items].sort((a, b) => Number(isReservationOrderItem(b)) - Number(isReservationOrderItem(a))).forEach((item) => {
    lines.push(formatOrderLine(item));
  });
  lines.push("");
  lines.push(`סה״כ הזמנה: ${formatPlainPrice(getOrderTotal(items))} ש״ח`);
  return lines.join("\n");
}

function formatQuantityUnit(quantity) {
  return quantity === 1 ? "יחידה" : "יחידות";
}

function formatOrderLine(item) {
  const prefix = `${item.quantity} ${formatQuantityUnit(item.quantity)} ${formatOrderItemModel(item)}`;
  if (item.fromReservation || item.priceSource === "reservation") return `${prefix} · משריון`;
  if (isBonusOrderItem(item)) return `${prefix} · ${getBonusOrderItemLabel(item)} · 0 ש״ח`;
  const line = `${prefix} לפי ${formatOrderPrice(item)}`;
  return item.priceSource === "display" ? `${line} · הנחת תצוגה 15%` : line;
}

function formatOrderPrice(item) {
  if (item.fromReservation || item.priceSource === "reservation") return "משריון";
  return `${formatPlainPrice(item.unitPrice)} ש״ח`;
}

function formatOrderItemModel(item) {
  const sku = cleanString(item.sku);
  if (sku) return `(${sku})`;
  return cleanString(item.description) || "פריט";
}

function getOrderItemShortDescription(item) {
  const product = getProductBySku(item?.skuKey || item?.sku);
  const description = cleanString(product?.description || item?.description);
  if (!description) return "";

  const conciseLabels = [
    [/4\s*דלתות/, "4 דלתות"],
    [/(?:מכונת\s+כביסה|מ\.?\s*כביסה)/, "מכונת כביסה"],
    [/(?:מייבש\s+כביסה|מייבש)/, "מייבש כביסה"],
    [/מקרר\s+משרדי/, "מקרר משרדי"],
    [/מקרר\s+ויטרינה/, "מקרר ויטרינה"],
    [/תנור\s+בנוי/, "תנור בנוי"],
    [/מדיח/, "מדיח כלים"],
    [/מקפיא\s+(\d+)\s+מגירות/, (_, drawers) => `מקפיא ${drawers} מגירות`],
    [/מקרר\s+מקפיא\s+עליון/, "מקרר מקפיא עליון"],
    [/מקרר\s+מקפיא\s+תחתון/, "מקרר מקפיא תחתון"],
    [/מקרר/, "מקרר"],
    [/מקפיא/, "מקפיא"],
    [/כיריים/, "כיריים"],
    [/מיקרוגל/, "מיקרוגל"],
    [/קולט/, "קולט אדים"],
  ];
  const match = conciseLabels.find(([pattern]) => pattern.test(description));
  if (match) {
    if (typeof match[1] === "function") {
      const groups = description.match(match[0]);
      return groups ? match[1](...groups) : "";
    }
    return match[1];
  }

  return cleanString(
    description
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:ליטר|קילו|ק״ג|ק"ג|ס"מ)\b/gi, "")
      .replace(/\b(?:NO-?FROST|NF|DE-?FROST|DF)\b/gi, "")
      .replace(/\b(?:לבן|לבנה|שחור|שחורה|כסוף|נירוסטה|שמנת)\b/g, ""),
  )
    .split(" ")
    .slice(0, 4)
    .join(" ");
}

function isReservationOrderItem(item) {
  return Boolean(item?.fromReservation || item?.priceSource === "reservation");
}

function isBonusOrderItem(item) {
  return item?.priceSource === "bonus";
}

function isTenPlusOneBonusItem(item) {
  return isBonusOrderItem(item) && normalizeBonusType(item?.bonusType) === "ten-plus-one";
}

function getBonusOrderItemLabel(item) {
  return isTenPlusOneBonusItem(item) ? "בונוס 10+1" : "בונוס";
}

function getProductBySku(value) {
  const skuKey = getSkuKey(value);
  const productBySku = products.find((product) => product.skuKey === skuKey);
  if (productBySku) return productBySku;
  const normalizedModel = getModelKey(value);
  return products.find((product) => getModelKey(product.skuKey || product.sku) === normalizedModel) || null;
}

function getReservationListPrice(value, fallback = null) {
  const product = getProductBySku(value);
  if (product && Number.isFinite(Number(product.price))) return Number(product.price);
  return fallback !== null && fallback !== "" && Number.isFinite(Number(fallback)) ? Number(fallback) : null;
}

function getCurrentReservationValue() {
  return reservations.reduce((sum, reservation) => {
    const price = getReservationListPrice(reservation.skuKey || reservation.sku);
    return price === null ? sum : sum + reservation.quantity * price;
  }, 0);
}

function getReservationModelsWithoutListPrice() {
  return [
    ...new Set(
      reservations
        .filter((reservation) => getReservationListPrice(reservation.skuKey || reservation.sku) === null)
        .map((reservation) => getModelKey(reservation.skuKey || reservation.sku)),
    ),
  ];
}

function getMonthlyReservationReleaseValue(reference = new Date()) {
  return orders
    .filter((order) => isSameMonth(getOrderReportDate(order), reference))
    .reduce(
      (sum, order) =>
        sum +
        order.items.filter(isReservationOrderItem).reduce((itemSum, item) => {
          const price = getReservationListPrice(item.skuKey || item.sku, item.listPrice);
          return price === null ? itemSum : itemSum + item.quantity * price;
        }, 0),
      0,
    );
}

function deleteOrder(orderId) {
  const order = orders.find((item) => item.id === orderId);
  if (!order) return;

  const label = order.customerName ? ` של ${order.customerName}` : "";
  const hasReservationItems = order.items.some((item) => item.fromReservation);
  const reservationPurchase = isReservationPurchaseOrder(order);
  const restoreMessage = reservationPurchase
    ? " יתרת השריון שנותרה מההזמנה תופחת, בלי לרדת למינוס."
    : hasReservationItems
      ? " המוצרים שנלקחו מהשריון יוחזרו למלאי הלקוח."
      : "";
  if (!window.confirm(`למחוק את ההזמנה${label}?${restoreMessage}`)) return;

  removeOrderReservationEffects(order);
  orders = orders.filter((item) => item.id !== orderId);
  if (editingOrderId === orderId) {
    editingOrderId = "";
    orderReportTomorrow = false;
    orderReportToday = false;
    cart = [];
    clearDraftCustomer();
    setOrderType("delivery", { render: false });
    saveCart();
    saveOrderReportTomorrow();
    saveSettings();
  }
  lastPrices = rebuildLastPricesFromOrders(orders);
  saveOrders();
  saveLastPrices();
  saveReservations({ sync: false });
  queueCloudSave();
  renderCart();
  renderOrders();
  renderCompletedOrders();
  renderTomorrowOrders();
  renderCustomersPanel();
  renderReservationsPanel();
  renderDashboard();
}

function reverseReservationPurchase(order) {
  const customer = getOrderCustomer(order) || customers.find((item) => item.id === order.customerId);
  if (!customer) return;
  order.items.forEach((line) => {
    adjustReservationBalance(customer, line, -parseQuantity(line.quantity));
  });
  sortReservations();
}

function moveOrderToDraft(orderId) {
  const order = orders.find((item) => item.id === orderId);
  if (!order) return;

  const label = order.customerName ? ` של ${order.customerName}` : "";
  const hasReservationItems = order.items.some((item) => item.fromReservation);
  const reservationPurchase = isReservationPurchaseOrder(order);

  const restoreMessage = reservationPurchase
    ? " יתרת השריון שנותרה מההזמנה תופחת, בלי לרדת למינוס."
    : hasReservationItems
      ? " המוצרים שנלקחו מהשריון יוחזרו למלאי הלקוח."
      : "";
  if (!window.confirm(`להעביר את ההזמנה${label} לטיוטות? היא תוסר מכל הדוחות והסיכומים.${restoreMessage}`)) {
    return;
  }

  removeOrderReservationEffects(order);

  const now = new Date().toISOString();
  const draft = {
    ...order,
    id: `draft-${Date.now()}`,
    updatedAt: now,
    draftReminderDate: normalizeDateInput(order.draftReminderDate),
    items: order.items.map((line) => ({
      ...line,
      lineTotal: roundMoney(line.quantity * line.unitPrice),
    })),
  };
  draft.total = getOrderTotal(draft.items);

  orders = orders.filter((item) => item.id !== orderId);
  drafts = [draft, ...drafts].sort(compareOrdersByCreatedAt);
  if (editingOrderId === orderId) {
    editingOrderId = "";
    orderReportTomorrow = false;
    orderReportToday = false;
    cart = [];
    clearDraftCustomer();
    setOrderType("delivery", { render: false });
    saveCart();
    saveOrderReportTomorrow();
    saveSettings();
  }

  lastPrices = rebuildLastPricesFromOrders(orders);
  saveOrders();
  saveDrafts({ sync: false });
  saveLastPrices();
  saveReservations({ sync: false });
  queueCloudSave();
  render();
  setActiveTab("drafts");
  dom.status.textContent = "ההזמנה הועברה לטיוטות והוסרה מהדוחות ומהסיכומים.";
}

function handleOrderActionClick(event) {
  const deleteButton = event.target.closest("[data-delete-order]");
  if (deleteButton) {
    deleteOrder(deleteButton.dataset.deleteOrder);
    return;
  }

  const moveToDraftButton = event.target.closest("[data-move-order-to-draft]");
  if (moveToDraftButton) {
    moveOrderToDraft(moveToDraftButton.dataset.moveOrderToDraft);
    return;
  }

  const duplicateButton = event.target.closest("[data-duplicate-order]");
  if (duplicateButton) {
    duplicateOrderToCart(duplicateButton.dataset.duplicateOrder);
    return;
  }

  const editButton = event.target.closest("[data-edit-order]");
  if (editButton) {
    startEditingOrder(editButton.dataset.editOrder);
    return;
  }

  const toggleButton = event.target.closest("[data-toggle-order-details]");
  if (toggleButton) {
    const card = toggleButton.closest(".order-card");
    const details = card?.querySelector(".order-text-details");
    if (!details) return;
    const shouldOpen = details.hidden;
    details.hidden = !shouldOpen;
    toggleButton.setAttribute("aria-expanded", String(shouldOpen));
    toggleButton.innerHTML = `${getOrderActionIcon("view")}<span>${shouldOpen ? "סגור הזמנה" : "הצג הזמנה"}</span>`;
    return;
  }

  const loadButton = event.target.closest("[data-load-order]");
  if (!loadButton) return;
  const order = orders.find((item) => item.id === loadButton.dataset.loadOrder);
  if (!order) return;
  const customer = getOrderCustomer(order);
  editingOrderId = "";
  editingDraftId = "";
  duplicatedOrderNeedsCustomer = false;
  orderReportTomorrow = false;
  orderReportToday = false;
  cart = mergeCartLines(
    order.items.map((item) => ({
      ...item,
      fromReservation: false,
      unitPrice: item.fromReservation ? item.listPrice : item.unitPrice,
      priceSource: item.fromReservation ? "list" : item.priceSource,
    })),
  );
  settings.customerId = customer?.id || order.customerId || "";
  settings.customerName = customer?.name || order.customerName || "";
  dom.customerName.value = settings.customerName;
  dom.saveAsDraft.checked = false;
  customerConfirmedForCurrentCart = Boolean(settings.customerName);
  setOrderType(order.orderType, { render: false });
  saveSettings();
  saveOrderReportTomorrow();
  saveCart();
  renderCart();
  renderCustomerHint();
  setActiveTab("cart");
  dom.status.textContent = "ההזמנה נטענה לסל.";
}

function handleDraftFieldChange(event) {
  const reminderDateInput = event.target.closest("[data-draft-reminder-date]");
  if (!reminderDateInput) return;
  dom.status.textContent = "כדי לשמור את התאריך לחץ על שמור תאריך.";
}

function handleDraftActionClick(event) {
  const whatsappButton = event.target.closest("[data-send-draft-whatsapp]");
  if (whatsappButton) {
    sendDraftToWhatsApp(whatsappButton.dataset.sendDraftWhatsapp);
    return;
  }

  const commitButton = event.target.closest("[data-commit-draft]");
  if (commitButton) {
    commitDraftToOrders(commitButton.dataset.commitDraft);
    return;
  }

  const editButton = event.target.closest("[data-edit-draft]");
  if (editButton) {
    startEditingDraft(editButton.dataset.editDraft);
    return;
  }

  const loadButton = event.target.closest("[data-load-draft]");
  if (loadButton) {
    loadDraftToCart(loadButton.dataset.loadDraft);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-draft]");
  if (deleteButton) {
    deleteDraft(deleteButton.dataset.deleteDraft);
    return;
  }

  const clearReminderButton = event.target.closest("[data-clear-draft-reminder]");
  if (clearReminderButton) {
    updateDraftReminderDate(clearReminderButton.dataset.clearDraftReminder, "");
    return;
  }

  const saveReminderDateButton = event.target.closest("[data-save-draft-reminder-date]");
  if (saveReminderDateButton) {
    const card = saveReminderDateButton.closest(".draft-card");
    const input = card?.querySelector(`[data-draft-reminder-date="${CSS.escape(saveReminderDateButton.dataset.saveDraftReminderDate)}"]`);
    updateDraftReminderDate(saveReminderDateButton.dataset.saveDraftReminderDate, input?.value || "");
    return;
  }

  const toggleButton = event.target.closest("[data-toggle-draft-details]");
  if (!toggleButton) return;
  const card = toggleButton.closest(".draft-card");
  const details = card?.querySelector(".order-text-details");
  if (!details) return;
  const shouldOpen = details.hidden;
  details.hidden = !shouldOpen;
  toggleButton.setAttribute("aria-expanded", String(shouldOpen));
  toggleButton.textContent = shouldOpen ? "סגור טיוטה" : "הצג טיוטה";
}

function updateDraftReminderDate(draftId, value) {
  const dueDate = normalizeDateInput(value);
  const draft = drafts.find((item) => item.id === draftId);
  if (!draft) return;

  drafts = drafts.map((item) =>
    item.id === draftId ? { ...item, draftReminderDate: dueDate, updatedAt: new Date().toISOString() } : item,
  );
  saveDrafts({ sync: false });

  const removedAutoReminder = removeDraftAutoReminder(draftId);
  queueCloudSave();
  renderDrafts();
  if (removedAutoReminder) renderRemindersPanel();
  renderDashboard();

  if (!dueDate) {
    dom.status.textContent = "תאריך הוצאת ההזמנה בטיוטה אופס.";
  } else {
    dom.status.textContent = `תאריך הוצאת ההזמנה נקבע ל-${formatReminderDate(dueDate)}.`;
  }
}

function getDraftReminderId(draftId) {
  return `draft-reminder-${draftId}`;
}

function removeDraftAutoReminder(draftId) {
  const reminderId = getDraftReminderId(draftId);
  const before = reminders.length;
  reminders = reminders.filter((reminder) => reminder.id !== reminderId);
  if (reminders.length === before) return false;
  saveReminders({ sync: false });
  return true;
}

function purgeDraftAutoReminders(options = { sync: true }) {
  const before = reminders.length;
  reminders = reminders.filter((reminder) => reminder.sourceType !== "draft" && !cleanString(reminder.id).startsWith("draft-reminder-"));
  if (reminders.length === before) return false;
  saveReminders({ sync: false });
  if (options.sync) queueCloudSave();
  return true;
}

function sendDraftToWhatsApp(draftId) {
  const draft = drafts.find((item) => item.id === draftId);
  if (!draft) return;
  if (!normalizePhone(settings.whatsappNumber)) {
    const message = "צריך להגדיר מספר וואטסאפ קבוע לפני שליחת טיוטה.";
    dom.status.textContent = message;
    window.alert(message);
    return;
  }

  const order = commitDraftToOrders(draftId, {
    status: "הטיוטה הוכנסה להזמנות ונפתחה לשליחה בוואטסאפ.",
  });
  if (!order) return;

  const url = createWhatsAppUrl(order.items, order);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

function commitDraftToOrders(draftId, options = {}) {
  let draft = drafts.find((item) => item.id === draftId);
  if (!draft) return null;
  if (editingDraftId === draft.id && cart.length) {
    draft = saveDraftOrder({
      activateTab: false,
      status: "השינויים בטיוטה נשמרו לפני ההכנסה להזמנות.",
    });
    if (!draft) return null;
  }
  const customer = getOrderCustomer(draft) || customers.find((item) => item.id === draft.customerId);
  if (isReservationPurchaseOrder(draft) && !customer) {
    const message = "כדי להכניס טיוטה לשריון צריך שהלקוח יהיה קיים.";
    dom.status.textContent = message;
    window.alert(message);
    return null;
  }

  const reservationError = isReservationPurchaseOrder(draft) ? "" : validateReservationItems(customer, draft.items);
  if (reservationError) {
    dom.status.textContent = reservationError;
    window.alert(reservationError);
    return null;
  }

  const now = new Date();
  const createdAt = now.toISOString();
  const order = {
    ...draft,
    id: `order-${Date.now()}`,
    createdAt,
    updatedAt: now.toISOString(),
    reportDate: getOrderReportDateForDraft(createdAt, isOrderReportedTomorrow(draft), isOrderReportedToday(draft)),
    items: draft.items.map((line) => ({
      ...line,
      lineTotal: roundMoney(line.quantity * line.unitPrice),
    })),
  };
  order.total = getOrderTotal(order.items);

  if (isReservationPurchaseOrder(order)) {
    addOrderToReservations(order);
  } else {
    deductOrderReservations(order);
  }

  orders = [order, ...orders].sort(compareOrdersByCreatedAt);
  drafts = drafts.filter((item) => item.id !== draft.id);
  removeDraftAutoReminder(draft.id);
  lastPrices = rebuildLastPricesFromOrders(orders);
  saveOrders();
  saveDrafts({ sync: false });
  saveReservations({ sync: false });
  saveLastPrices();
  queueCloudSave();
  render();
  if (options.activateTab !== false) setActiveTab("orders");
  dom.status.textContent = options.status || "הטיוטה הוכנסה להזמנות לפי זמן שמירת הטיוטה.";
  return order;
}

function loadDraftToCart(draftId) {
  const draft = drafts.find((item) => item.id === draftId);
  if (!draft) return;
  if (cart.length && !window.confirm("להחליף את הסל הנוכחי בטיוטה?")) return;

  const customer = getOrderCustomer(draft);
  editingOrderId = "";
  editingDraftId = "";
  duplicatedOrderNeedsCustomer = false;
  orderReportTomorrow = isOrderReportedTomorrow(draft);
  orderReportToday = isOrderReportedToday(draft);
  cart = mergeCartLines(draft.items.map((item) => ({ ...item })));
  settings.customerId = customer?.id || draft.customerId || "";
  settings.customerName = customer?.name || draft.customerName || "";
  dom.customerName.value = settings.customerName;
  dom.saveAsDraft.checked = false;
  customerConfirmedForCurrentCart = Boolean(settings.customerName);
  setOrderType(draft.orderType, { render: false });
  saveSettings();
  saveOrderReportTomorrow();
  saveCart();
  render();
  setActiveTab("cart");
  dom.status.textContent = "הטיוטה נטענה לסל. הטיוטה המקורית עדיין שמורה עד שתמחק אותה או תכניס להזמנות.";
}

function startEditingDraft(draftId) {
  const draft = drafts.find((item) => item.id === draftId);
  if (!draft) return;
  if (cart.length && editingDraftId === draft.id) {
    setActiveTab("cart");
    dom.status.textContent = "הטיוטה כבר פתוחה לעריכה.";
    return;
  }
  if (cart.length && editingDraftId !== draft.id && !window.confirm("להחליף את הסל הנוכחי בעריכת הטיוטה?")) return;

  const customer = getOrderCustomer(draft);
  editingOrderId = "";
  editingDraftId = draft.id;
  duplicatedOrderNeedsCustomer = false;
  orderReportTomorrow = isOrderReportedTomorrow(draft);
  orderReportToday = isOrderReportedToday(draft);
  cart = mergeCartLines(draft.items.map((item) => ({ ...item })));
  settings.customerId = customer?.id || draft.customerId || "";
  settings.customerName = customer?.name || draft.customerName || "";
  dom.customerName.value = settings.customerName;
  dom.saveAsDraft.checked = true;
  customerConfirmedForCurrentCart = Boolean(settings.customerName);
  setOrderType(draft.orderType, { render: false });
  saveSettings();
  saveOrderReportTomorrow();
  saveCart();
  render();
  setActiveTab("cart");
  dom.status.textContent = "הטיוטה נטענה לעריכה. שמירה תעדכן את הטיוטה הקיימת ולא תכניס אותה להזמנות.";
}

function deleteDraft(draftId) {
  const draft = drafts.find((item) => item.id === draftId);
  if (!draft) return;
  const label = draft.customerName ? ` של ${draft.customerName}` : "";
  if (!window.confirm(`למחוק את הטיוטה${label}?`)) return;
  drafts = drafts.filter((item) => item.id !== draftId);
  removeDraftAutoReminder(draftId);
  if (editingDraftId === draftId) {
    cart = [];
    editingDraftId = "";
    duplicatedOrderNeedsCustomer = false;
    orderReportTomorrow = false;
    orderReportToday = false;
    dom.saveAsDraft.checked = false;
    clearDraftCustomer();
    setOrderType("delivery", { render: false });
    saveCart();
    saveSettings();
    saveOrderReportTomorrow();
  }
  saveDrafts();
  render();
  dom.status.textContent = "הטיוטה נמחקה.";
}

function startEditingOrder(orderId) {
  const order = orders.find((item) => item.id === orderId);
  if (!order) return;
  if (cart.length && editingOrderId !== order.id && !window.confirm("להחליף את הסל הנוכחי בעריכת ההזמנה?")) return;

  const customer = getOrderCustomer(order);
  editingOrderId = order.id;
  editingDraftId = "";
  duplicatedOrderNeedsCustomer = false;
  orderReportTomorrow = isOrderReportedTomorrow(order);
  orderReportToday = isOrderReportedToday(order);
  cart = mergeCartLines(order.items.map((item) => ({ ...item })));
  settings.customerId = customer?.id || order.customerId || "";
  settings.customerName = customer?.name || order.customerName || "";
  dom.customerName.value = settings.customerName;
  dom.saveAsDraft.checked = false;
  customerConfirmedForCurrentCart = Boolean(settings.customerName);
  setOrderType(order.orderType, { render: false });
  saveSettings();
  saveOrderReportTomorrow();
  saveCart();
  render();
  setActiveTab("cart");
  dom.status.textContent = "ההזמנה נטענה לעריכה. שמירת השינויים תעדכן את ההזמנה הקיימת.";
}

function duplicateOrderToCart(orderId) {
  const order = orders.find((item) => item.id === orderId);
  if (!order) return;
  if (cart.length && !window.confirm("להחליף את הסל הנוכחי בעותק של ההזמנה?")) return;

  editingOrderId = "";
  editingDraftId = "";
  orderReportTomorrow = false;
  orderReportToday = false;
  dom.saveAsDraft.checked = false;
  cart = mergeCartLines(
    order.items.map((item) => {
      const wasFromReservation = isReservationOrderItem(item);
      const unitPrice = wasFromReservation
        ? getReservationListPrice(item.skuKey || item.sku, item.listPrice) ?? 0
        : item.unitPrice;
      const priceSource = wasFromReservation
        ? "list"
        : item.priceSource === "display" || item.priceSource === "list" || item.priceSource === "bonus"
          ? item.priceSource
          : "custom";
      return {
        ...item,
        fromReservation: false,
        unitPrice,
        priceSource,
        lineTotal: roundMoney(item.quantity * unitPrice),
      };
    }),
  );
  clearDraftCustomer();
  duplicatedOrderNeedsCustomer = true;
  setOrderType(order.orderType, { render: false });
  saveSettings();
  saveOrderReportTomorrow();
  saveCart();
  render();
  setActiveTab("cart");
  dom.status.textContent = "ההזמנה שוכפלה. נשאר לבחור לקוח חדש ולשמור.";
  window.setTimeout(() => {
    dom.customerName.scrollIntoView({ behavior: "smooth", block: "center" });
    dom.customerName.focus();
  }, 50);
}

function rebuildLastPricesFromOrders(orderList) {
  return [...orderList]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .reduce((prices, order) => {
      order.items.forEach((line) => {
        if (line.fromReservation || line.priceSource === "reservation" || isBonusOrderItem(line)) return;
        prices[line.skuKey] = {
          price: line.unitPrice,
          savedAt: order.createdAt,
        };
      });
      return prices;
    }, {});
}

function getOrderTotal(items) {
  return roundMoney(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
}

function getPaidSalesTotal(items) {
  return roundMoney(
    items.reduce(
      (sum, item) => (isReservationOrderItem(item) ? sum : sum + item.quantity * item.unitPrice),
      0,
    ),
  );
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function saveSettings(options = { sync: false }) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (options.sync) queueCloudSave();
}

function saveOrderReportTomorrow() {
  localStorage.setItem(ORDER_REPORT_TOMORROW_KEY, JSON.stringify(orderReportTomorrow));
  localStorage.setItem(ORDER_REPORT_TODAY_KEY, JSON.stringify(orderReportToday));
}

function saveProductData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
  localStorage.setItem(META_KEY, JSON.stringify(activeMeta));
}

function saveCategories() {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
  queueCloudSave();
}

function saveAnnotations() {
  localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations));
  queueCloudSave();
}

function saveOrders() {
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
}

function saveDrafts(options = { sync: true }) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  if (options.sync) queueCloudSave();
}

function saveCustomers() {
  localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
  queueCloudSave();
}

function saveLastPrices() {
  localStorage.setItem(LAST_PRICES_KEY, JSON.stringify(lastPrices));
}

function saveReservations(options = { sync: true }) {
  localStorage.setItem(RESERVATIONS_KEY, JSON.stringify(reservations));
  localStorage.setItem(RESERVATION_SEED_KEY, JSON.stringify(reservationSeedVersion));
  if (options.sync) queueCloudSave();
}

function saveReminders(options = { sync: true }) {
  localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
  if (options.sync) queueCloudSave();
}

function saveCollections(options = { sync: true }) {
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
  if (options.sync) queueCloudSave();
}

function persistSharedStateLocally() {
  saveProductData();
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
  localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations));
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(customers));
  localStorage.setItem(LAST_PRICES_KEY, JSON.stringify(lastPrices));
  localStorage.setItem(RESERVATIONS_KEY, JSON.stringify(reservations));
  localStorage.setItem(RESERVATION_SEED_KEY, JSON.stringify(reservationSeedVersion));
  localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders));
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function queueCloudSave(delay = 450) {
  if (CLOUD_SYNC_DISABLED) return;

  if (!cloudHydrated) {
    cloudSaveAgain = true;
    return;
  }

  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(saveSharedStateNow, delay);
}

async function saveSharedStateNow() {
  if (CLOUD_SYNC_DISABLED) return;

  if (cloudSaveInFlight) {
    cloudSaveAgain = true;
    return;
  }

  cloudSaveInFlight = true;
  cloudSyncState = "saving";
  renderMetadata();

  try {
    const response = await fetch(CLOUD_STATE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(buildSharedState()),
    });

    if (response.status === 401) {
      lockApp("יש להתחבר מחדש כדי לשמור נתונים.");
      return;
    }
    if (!response.ok) throw new Error(`Cloud save failed: ${response.status}`);
    cloudSyncState = "synced";
  } catch (error) {
    console.warn("Cloud save failed", error);
    cloudSyncState = "offline";
  } finally {
    cloudSaveInFlight = false;
    renderMetadata();

    if (cloudSaveAgain) {
      cloudSaveAgain = false;
      queueCloudSave(0);
    }
  }
}

function hasCloudState(state) {
  if (!state || typeof state !== "object") return false;
  return Boolean(
    state.updatedAt ||
      (Array.isArray(state.products) && state.products.length) ||
      (Array.isArray(state.categories) && state.categories.length) ||
      (Array.isArray(state.customers) && state.customers.length) ||
      (Array.isArray(state.orders) && state.orders.length) ||
      (Array.isArray(state.drafts) && state.drafts.length) ||
      (Array.isArray(state.reservations) && state.reservations.length) ||
      (Array.isArray(state.reminders) && state.reminders.length) ||
      (Array.isArray(state.collections) && state.collections.length) ||
      Object.keys(state.annotations || {}).length ||
      Object.keys(state.lastPrices || {}).length ||
      cleanString(state.settings?.whatsappNumber),
  );
}

function buildSharedState() {
  return {
    version: 6,
    products: products.map(({ sku, description, price, stockQuantity }) => ({
      sku,
      description,
      price,
      ...(Number.isFinite(Number(stockQuantity)) ? { stockQuantity: Number(stockQuantity) } : {}),
    })),
    meta: activeMeta,
    categories,
    customers,
    annotations,
    orders,
    orderCompletionMigrationVersion,
    orderOpenRestoreMigrationVersion,
    drafts,
    lastPrices,
    reservations,
    reservationSeedVersion,
    reminders,
    collections,
    settings: {
      whatsappNumber: settings.whatsappNumber || "",
    },
  };
}

function applySharedState(state) {
  const cloudProducts = normalizeProducts(state.products || []);
  if (cloudProducts.length) {
    products = ensureGeneralProduct(cloudProducts);
    activeMeta = state.meta || {
      sourceName: "מחירון מהענן",
      importedAt: null,
      count: products.length,
    };
  }

  categories = normalizeCategories(state.categories);
  const cloudCustomers = normalizeCustomers(state.customers);
  customers = cloudCustomers.length ? cloudCustomers : customers.length ? customers : getDefaultCustomers();
  annotations = normalizeAnnotations(state.annotations);
  orders = normalizeOrders(state.orders);
  orderCompletionMigrationVersion = Math.max(0, Math.floor(Number(state.orderCompletionMigrationVersion) || 0));
  orderOpenRestoreMigrationVersion = Math.max(0, Math.floor(Number(state.orderOpenRestoreMigrationVersion) || 0));
  const migratedCompletedOrders = completeDueOrders({
    completeExistingOrders: orderCompletionMigrationVersion < ORDER_COMPLETION_MIGRATION_VERSION,
  });
  if (orderCompletionMigrationVersion < ORDER_COMPLETION_MIGRATION_VERSION) {
    orderCompletionMigrationVersion = ORDER_COMPLETION_MIGRATION_VERSION;
  }
  const restoredCurrentDayOrders =
    orderOpenRestoreMigrationVersion < ORDER_OPEN_RESTORE_MIGRATION_VERSION ? restoreCurrentDayOpenOrders() : 0;
  if (orderOpenRestoreMigrationVersion < ORDER_OPEN_RESTORE_MIGRATION_VERSION) {
    orderOpenRestoreMigrationVersion = ORDER_OPEN_RESTORE_MIGRATION_VERSION;
  }
  drafts = normalizeDrafts(state.drafts);
  lastPrices = normalizeLastPrices(state.lastPrices);
  if (!Object.keys(lastPrices).length) {
    lastPrices = rebuildLastPricesFromOrders(orders);
  }

  const cloudReservations = normalizeReservations(state.reservations);
  const cloudSeedVersion = Math.max(0, Math.floor(Number(state.reservationSeedVersion) || 0));
  const shouldSeedReservations = cloudSeedVersion < RESERVATION_SEED_VERSION;
  reservations = shouldSeedReservations ? mergeDefaultReservations(cloudReservations) : cloudReservations;
  reservationSeedVersion = shouldSeedReservations ? RESERVATION_SEED_VERSION : cloudSeedVersion;
  reminders = normalizeReminders(state.reminders);
  collections = normalizeCollections(state.collections);
  const migratedCollectionReminders = migrateCollectionDueDatesToReminders({ sync: false });

  settings = {
    ...settings,
    whatsappNumber: cleanString(state.settings?.whatsappNumber || settings.whatsappNumber),
  };
  if (settings.customerId && !customers.some((customer) => customer.id === settings.customerId)) {
    settings.customerId = "";
  }
  if (activeCustomerId && !customers.some((customer) => customer.id === activeCustomerId)) {
    activeCustomerId = customers[0]?.id || "";
  }
  dom.whatsappNumber.value = settings.whatsappNumber || "";
  const removedDraftReminders = purgeDraftAutoReminders({ sync: false });

  return {
    seededReservations: shouldSeedReservations,
    removedDraftReminders,
    migratedCollectionReminders,
    migratedCompletedOrders,
    restoredCurrentDayOrders,
  };
}

function readCustomers() {
  const stored = normalizeCustomers(readJson(CUSTOMERS_KEY));
  return stored.length ? stored : getDefaultCustomers();
}

function readCart() {
  const stored = readJson(CART_KEY);
  if (!Array.isArray(stored)) return [];
  const normalizedLines = stored
    .map((line) => {
      const skuKey = getSkuKey(line.skuKey || line.sku);
      const fromReservation = Boolean(line.fromReservation || line.priceSource === "reservation");
      const unitPrice = fromReservation ? 0 : parsePrice(line.unitPrice) ?? 0;
      const priceSource = fromReservation ? "reservation" : normalizePriceSource(line.priceSource);
      const bonusType = normalizeBonusType(line.bonusType);
      return {
        lineKey: createCartLineKey(skuKey, fromReservation, unitPrice, priceSource, bonusType),
        skuKey,
        sku: cleanString(line.sku),
        description: cleanString(line.description),
        listPrice: parsePrice(line.listPrice) ?? 0,
        unitPrice,
        priceSource,
        bonusType,
        quantity: parseQuantity(line.quantity),
        fromReservation,
      };
    })
    .filter((line) => line.skuKey && line.description && line.quantity > 0);
  return mergeCartLines(normalizedLines);
}

function readOrders() {
  return normalizeOrders(readJson(ORDERS_KEY));
}

function readDrafts() {
  return normalizeDrafts(readJson(DRAFTS_KEY));
}

function normalizeOrders(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((order) => ({
      id: cleanString(order.id) || `order-${Date.now()}`,
      createdAt: order.createdAt || new Date().toISOString(),
      updatedAt: order.updatedAt || "",
      completedAt: cleanString(order.completedAt),
      reportDate: normalizeDateInput(order.reportDate) || getLocalDateKey(getSafeDate(order.createdAt)),
      customerId: cleanString(order.customerId),
      customerName: cleanString(order.customerName),
      customerCode: cleanString(order.customerCode),
      customerPhone: cleanString(order.customerPhone),
      orderType: normalizeOrderType(order.orderType),
      draftReminderDate: normalizeDateInput(order.draftReminderDate),
      items: Array.isArray(order.items)
        ? order.items.map((line) => ({
            lineKey: cleanString(line.lineKey),
            skuKey: getSkuKey(line.skuKey || line.sku),
            sku: cleanString(line.sku),
            description: cleanString(line.description),
            listPrice: parsePrice(line.listPrice) ?? 0,
            unitPrice: parsePrice(line.unitPrice) ?? 0,
            priceSource: normalizePriceSource(line.priceSource),
            bonusType: normalizeBonusType(line.bonusType),
            quantity: parseQuantity(line.quantity),
            lineTotal: parsePrice(line.lineTotal) ?? 0,
            fromReservation: Boolean(line.fromReservation || line.priceSource === "reservation"),
          }))
        : [],
      total: parsePrice(order.total) ?? 0,
    }))
    .filter((order) => order.items.length);
}

function normalizeDrafts(value) {
  return normalizeOrders(value).sort(compareOrdersByCreatedAt);
}

function normalizeCustomers(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  return value
    .map((customer) => {
      const storedName = cleanString(typeof customer === "string" ? customer : customer?.name);
      if (!storedName) return null;
      const id = cleanString(customer?.id) || createCustomerId(storedName);
      const name = id === "default-customer-3" && storedName === "אולשופ (אהרון חיים("
        ? "אולשופ (אהרון חיים)"
        : storedName;
      return {
        id,
        code: cleanString(customer?.code),
        name,
        phone: cleanString(customer?.phone),
        createdAt: customer?.createdAt || new Date().toISOString(),
        updatedAt: customer?.updatedAt || customer?.createdAt || new Date().toISOString(),
      };
    })
    .filter(Boolean)
    .filter((customer) => {
      const key = normalizeSearch(customer.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

function getDefaultCustomers() {
  return normalizeCustomers(
    DEFAULT_CUSTOMER_NAMES.map((name, index) => ({
      id: `default-customer-${index + 1}`,
      name,
      code: "",
      phone: "",
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    })),
  );
}

function createCustomerId(name) {
  const normalized = normalizeSearch(name).replace(/\s+/g, "-").slice(0, 48);
  return `customer-${normalized || Date.now()}-${Date.now().toString(36)}`;
}

function normalizeCategories(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  return value
    .map(cleanString)
    .filter(Boolean)
    .filter((category) => {
      const key = normalizeSearch(category);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.localeCompare(b, "he"));
}

function normalizeAnnotations(value) {
  if (!value || typeof value !== "object") return {};

  return Object.entries(value).reduce((next, [skuKey, annotation]) => {
    const key = getSkuKey(skuKey);
    if (!key || !annotation || typeof annotation !== "object") return next;

    const category = cleanString(annotation.category);
    const note = cleanString(annotation.note);
    const arrivalDate = normalizeDateInput(annotation.arrivalDate);
    if (category || note || arrivalDate) next[key] = { category, note, arrivalDate };
    return next;
  }, {});
}

function normalizeLastPrices(value) {
  if (!value || typeof value !== "object") return {};

  return Object.entries(value).reduce((next, [skuKey, priceData]) => {
    const key = getSkuKey(skuKey);
    const price = parsePrice(priceData?.price);
    if (!key || price === null) return next;
    next[key] = {
      price,
      savedAt: priceData?.savedAt || new Date().toISOString(),
    };
    return next;
  }, {});
}

function readReminders() {
  return normalizeReminders(readJson(REMINDERS_KEY));
}

function readCollections() {
  return normalizeCollections(readJson(COLLECTIONS_KEY));
}

function normalizeCollections(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const id = cleanString(item.id) || `collection-imported-${index}-${Date.now()}`;
      if (seen.has(id)) return null;
      seen.add(id);
      const invoices = normalizeCollectionInvoices(item.invoices);
      const months = buildCollectionMonths(invoices, item.months);
      const amount = parsePrice(item.amount) ?? (months.length ? months.reduce((sum, month) => sum + month.amount, 0) : null);
      if (amount === null) return null;
      if (amount <= 0 && !invoices.length && cleanString(item.sourceType) !== "aging-report") return null;
      const customer =
        customers.find((candidate) => candidate.id === cleanString(item.customerId)) ||
        findCustomerByLooseName(item.customerName);
      const customerName = customer?.name || cleanString(item.customerName);
      if (!customerName) return null;
      const paidAmount = item.paid
        ? Math.max(0, roundMoney(amount))
        : roundMoney(Math.min(Math.max(0, roundMoney(amount)), Math.max(0, parsePrice(item.paidAmount) ?? 0)));
      const paid = months.length ? months.every((month) => getCollectionMonthOpenAmount(month) <= 0) : paidAmount >= amount;
      return {
        id,
        customerId: customer?.id || cleanString(item.customerId),
        customerName,
        accountNumber: cleanString(item.accountNumber),
        amount: roundMoney(amount),
        paidAmount,
        invoices,
        months,
        dueDate: normalizeDateInput(item.dueDate),
        note: cleanString(item.note),
        paid,
        paidAt: paid ? item.paidAt || item.updatedAt || new Date().toISOString() : "",
        sourceType: cleanString(item.sourceType),
        sourceName: cleanString(item.sourceName),
        importedAt: item.importedAt || "",
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

function normalizeReminders(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const title = cleanString(item.title);
      if (!title) return null;
      const id = cleanString(item.id) || `reminder-imported-${index}-${Date.now()}`;
      if (seen.has(id)) return null;
      seen.add(id);
      const customer =
        customers.find((candidate) => candidate.id === cleanString(item.customerId)) ||
        findCustomerByName(item.customerName);
      const completed = Boolean(item.completed);
      return {
        id,
        title,
        dueDate: normalizeDateInput(item.dueDate),
        customerId: customer?.id || cleanString(item.customerId),
        customerName: customer?.name || cleanString(item.customerName),
        completed,
        completedAt: completed ? item.completedAt || item.updatedAt || new Date().toISOString() : "",
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
        sourceType: cleanString(item.sourceType),
        sourceId: cleanString(item.sourceId),
      };
    })
    .filter(Boolean)
    .sort(compareReminders);
}

function readReservations() {
  return normalizeReservations(readJson(RESERVATIONS_KEY));
}

function normalizeReservations(value) {
  if (!Array.isArray(value)) return [];
  const normalized = new Map();

  value.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const customer =
      customers.find((candidate) => candidate.id === cleanString(item.customerId)) ||
      findCustomerByName(item.customerName);
    const customerId = customer?.id || cleanString(item.customerId);
    const customerName = customer?.name || cleanString(item.customerName);
    const sku = cleanString(item.sku || item.skuKey);
    const skuKey = getSkuKey(item.skuKey || sku);
    if (!customerId || !customerName || !skuKey) return;

    const key = `${customerId}|${skuKey}`;
    normalized.set(key, {
      id: cleanString(item.id) || createReservationId(customerId, skuKey),
      customerId,
      customerName,
      skuKey,
      sku: sku || skuKey,
      description: cleanString(item.description),
      quantity: parseNonNegativeInteger(item.quantity),
      updatedAt: item.updatedAt || new Date().toISOString(),
    });
  });

  return [...normalized.values()].sort(
    (a, b) => a.customerName.localeCompare(b.customerName, "he") || a.sku.localeCompare(b.sku, "en"),
  );
}

function mergeDefaultReservations(value) {
  const merged = normalizeReservations(value);
  const seen = new Set(merged.map((item) => `${item.customerId}|${item.skuKey}`));

  DEFAULT_RESERVATION_GROUPS.forEach((group) => {
    const customer = findReservationSeedCustomer(group.customerName);
    if (!customer) return;
    group.items.forEach(([sku, quantity]) => {
      const skuKey = getSkuKey(sku);
      const key = `${customer.id}|${skuKey}`;
      if (seen.has(key)) return;
      const product = products.find((item) => item.skuKey === skuKey);
      merged.push({
        id: createReservationId(customer.id, skuKey),
        customerId: customer.id,
        customerName: customer.name,
        skuKey,
        sku: product?.sku || sku,
        description: product?.description || "",
        quantity: parseNonNegativeInteger(quantity),
        updatedAt: "2026-06-20T20:24:00.000Z",
      });
      seen.add(key);
    });
  });

  return normalizeReservations(merged);
}

function findReservationSeedCustomer(name) {
  const identity = normalizeCustomerIdentity(name);
  const defaultIndex = DEFAULT_CUSTOMER_NAMES.findIndex((customerName) => normalizeCustomerIdentity(customerName) === identity);
  const defaultId = defaultIndex >= 0 ? `default-customer-${defaultIndex + 1}` : "";
  return (
    customers.find((customer) => customer.id === defaultId) ||
    customers.find((customer) => normalizeCustomerIdentity(customer.name) === identity) ||
    null
  );
}

function normalizeCustomerIdentity(value) {
  return normalizeSearch(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeCustomerIdentityWithSortedNumbers(value) {
  const normalized = normalizeSearch(value);
  const text = normalized.replace(/\d+/g, "").replace(/[^\p{L}\p{N}]/gu, "");
  const numbers = normalized.match(/\d+/g) || [];
  return `${text}|${numbers.sort((a, b) => Number(a) - Number(b)).join("|")}`;
}

function createReservationId(customerId, skuKey) {
  return `reservation-${customerId}-${getModelKey(skuKey)}`;
}

function resetToDefaultData() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(META_KEY);
  products = defaultProducts;
  activeMeta = {
    sourceName: "מחירון ברירת מחדל",
    importedAt: null,
    count: products.length,
  };
  dom.searchInput.value = "";
  render();
  queueCloudSave();
  dom.status.textContent = "חזרת לנתוני הפתיחה.";
}

function setBusy(message) {
  dom.status.textContent = message;
  dom.results.replaceChildren();
}

function readCategories() {
  return normalizeCategories(readJson(CATEGORIES_KEY));
}

function createOption(value, label, selected) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  return option;
}

function cleanString(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = cleanString(value);
  if (!raw) return null;

  const withoutCurrency = raw.replace(/[₪\s]/g, "");
  const normalized =
    withoutCurrency.includes(",") && !withoutCurrency.includes(".")
      ? withoutCurrency.replace(",", ".")
      : withoutCurrency.replace(/,/g, "");
  const number = Number(normalized.replace(/[^\d.-]/g, ""));

  return Number.isFinite(number) ? number : null;
}

function parseQuantity(value) {
  const quantity = Number.parseInt(value, 10);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function parseNonNegativeInteger(value) {
  const quantity = Number.parseInt(value, 10);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
}

function parseStockQuantity(value) {
  if (value === null || value === undefined || value === "") return null;
  const raw = typeof value === "number" ? value : Number(cleanString(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.floor(raw));
}

function hasStockQuantity(product) {
  return Number.isFinite(Number(product?.stockQuantity));
}

function getStockTone(product) {
  if (!hasStockQuantity(product)) return "";
  const quantity = Number(product.stockQuantity);
  if (quantity < 10) return "low";
  if (quantity <= 50) return "medium";
  return "high";
}

function formatStockQuantity(product) {
  if (!hasStockQuantity(product)) return "";
  return Number(product.stockQuantity).toLocaleString("he-IL");
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizePhone(value) {
  const raw = cleanString(value);
  if (!raw) return "";

  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return digits;
}

function formatPrice(price) {
  return currencyFormatter.format(price);
}

function formatPlainPrice(price) {
  const value = roundMoney(price);
  return value.toLocaleString("he-IL", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function normalizePriceSource(value) {
  return ["list", "last", "custom", "display", "reservation", "bonus"].includes(value) ? value : "custom";
}

function normalizeBonusType(value) {
  return value === "ten-plus-one" ? "ten-plus-one" : "";
}

function normalizeOrderType(value) {
  return value === "reservation" ? "reservation" : "delivery";
}

function normalizeHeader(value) {
  return normalizeSearch(value).replace(/["'״׳]/g, "");
}

function normalizeSearch(value) {
  return cleanString(value)
    .toLocaleLowerCase("he-IL")
    .normalize("NFKD")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[״"׳']/g, "")
    .replace(/[^\p{L}\p{N}.+-]+/gu, " ")
    .trim();
}

function getSkuKey(value) {
  return cleanString(value).toLocaleUpperCase("en-US");
}

function getModelKey(value) {
  return cleanString(value).toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");
}

function escapeHtml(value) {
  return cleanString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hasAny(value, words) {
  return words.some((word) => value.includes(normalizeSearch(word)));
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    console.warn("Service worker registration failed", error);
  });
}

import assert from "node:assert/strict";
import { mergeRecentMissingOrders } from "../api/_order-conflict-recovery.js";

const now = new Date("2026-07-15T15:00:00.000Z");
const recentOrder = {
  id: "order-new",
  createdAt: "2026-07-15T14:55:00.000Z",
  customerId: "customer-new",
  customerName: "לקוח חדש",
  orderType: "reservation",
  items: [{ skuKey: "SKU-1", sku: "SKU-1", description: "מוצר בדיקה", quantity: 2, unitPrice: 100 }],
};
const currentState = {
  orders: [],
  customers: [],
  reservations: [],
  lastPrices: {},
  orderTombstones: [],
};
const attemptedState = {
  ...currentState,
  orders: [recentOrder],
  customers: [{ id: "customer-new", name: "לקוח חדש" }],
};

const recovered = mergeRecentMissingOrders(currentState, attemptedState, now);
assert.equal(recovered.recovered, true, "recent missing order must be recovered");
assert.equal(recovered.addedOrders.length, 1, "exactly one order must be added");
assert.equal(recovered.addedCustomers.length, 1, "linked customer must be retained");
assert.equal(recovered.state.reservations[0].quantity, 2, "reservation purchase must retain its balance effect");

const deletedState = {
  ...currentState,
  orderTombstones: [{ id: "order-new", deletedAt: "2026-07-15T14:59:00.000Z" }],
};
assert.equal(
  mergeRecentMissingOrders(deletedState, attemptedState, now).recovered,
  false,
  "a deliberately deleted order must never be resurrected from an old tab",
);

const oldAttempt = {
  ...attemptedState,
  orders: [{ ...recentOrder, id: "order-old", createdAt: "2026-07-10T14:55:00.000Z" }],
};
assert.equal(
  mergeRecentMissingOrders(currentState, oldAttempt, now).recovered,
  false,
  "an old historical order must not be silently restored",
);

console.log("Order safety checks passed.");

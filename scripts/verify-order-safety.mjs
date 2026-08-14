import assert from "node:assert/strict";
import {
  findUnexpectedOrderRemovals,
  mergeRecentMissingOrders,
  recoverExplicitOrderDeletions,
} from "../api/_order-conflict-recovery.js";

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

assert.deepEqual(
  findUnexpectedOrderRemovals(
    { orders: [recentOrder] },
    { orders: [], orderTombstones: [] },
    "state-change",
    now,
  ),
  ["order-new"],
  "a save without an explicit deletion confirmation must not remove an order",
);
assert.deepEqual(
  findUnexpectedOrderRemovals(
    { orders: [recentOrder] },
    { orders: [], orderTombstones: [{ id: "order-new", deletedAt: "2026-07-15T14:59:00.000Z" }] },
    "order-delete",
    now,
  ),
  [],
  "a deliberate deletion with a tombstone must remain possible",
);

const concurrentOrder = {
  ...recentOrder,
  id: "order-concurrent",
  customerId: "customer-concurrent",
  customerName: "לקוח ממסך אחר",
  orderType: "delivery",
};
const recoveredDeletion = recoverExplicitOrderDeletions(
  {
    orders: [recentOrder, concurrentOrder],
    customers: [
      { id: "customer-new", name: "לקוח חדש" },
      { id: "customer-concurrent", name: "לקוח ממסך אחר" },
    ],
    reservations: [{ id: "reservation-test", customerId: "customer-new", skuKey: "SKU-1", quantity: 2 }],
    lastPrices: {},
    orderTombstones: [],
  },
  {
    orders: [],
    orderTombstones: [{ id: "order-new", deletedAt: "2026-07-15T14:59:00.000Z" }],
  },
  "order-delete",
  now,
);
assert.equal(recoveredDeletion.recovered, true, "a confirmed deletion must survive a concurrent state version change");
assert.deepEqual(recoveredDeletion.state.orders.map((order) => order.id), ["order-concurrent"], "a concurrent unrelated order must remain untouched");
assert.equal(recoveredDeletion.state.reservations[0].quantity, 0, "deleting a reservation purchase must reverse its balance");
assert.equal(recoveredDeletion.state.orderTombstones[0].id, "order-new", "the recovered deletion must retain its tombstone");

const reservedDelivery = {
  ...recentOrder,
  id: "order-reserved-delivery",
  orderType: "delivery",
  items: [{ ...recentOrder.items[0], fromReservation: true, priceSource: "reservation" }],
};
const recoveredReservedDelivery = recoverExplicitOrderDeletions(
  {
    orders: [reservedDelivery],
    customers: [{ id: "customer-new", name: "לקוח חדש" }],
    reservations: [{ id: "reservation-test", customerId: "customer-new", skuKey: "SKU-1", quantity: 0 }],
    lastPrices: {},
    orderTombstones: [],
  },
  {
    orders: [],
    orderTombstones: [{ id: "order-reserved-delivery", deletedAt: "2026-07-15T14:59:00.000Z" }],
  },
  "order-delete",
  now,
);
assert.equal(recoveredReservedDelivery.state.reservations[0].quantity, 2, "deleting a reservation release must restore its balance");
assert.equal(
  recoverExplicitOrderDeletions(currentState, deletedState, "state-change", now).recovered,
  false,
  "an ordinary stale save must never gain deletion authority",
);

console.log("Order safety checks passed.");

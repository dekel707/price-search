const RECOVERY_WINDOW_MS = 48 * 60 * 60 * 1000;
const TOMBSTONE_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

// A full-state save from an older open tab must never overwrite live data.
// New orders are the one safe exception: they are append-only records with a
// stable id, so we can add only the missing, recently-created orders while
// preserving every newer live value.
export function mergeRecentMissingOrders(currentState, attemptedState, now = new Date()) {
  const liveOrders = Array.isArray(currentState?.orders) ? currentState.orders : [];
  const attemptedOrders = Array.isArray(attemptedState?.orders) ? attemptedState.orders : [];
  const liveIds = new Set(liveOrders.map((order) => String(order?.id || "")).filter(Boolean));
  const tombstonedIds = new Set(getActiveTombstones(currentState?.orderTombstones, now).map((entry) => entry.id));
  const cutoff = now.getTime() - RECOVERY_WINDOW_MS;
  const addedOrders = attemptedOrders.filter((order) => {
    const id = String(order?.id || "").trim();
    if (!id || liveIds.has(id) || tombstonedIds.has(id)) return false;
    const createdAt = new Date(order?.createdAt || 0).getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff && createdAt <= now.getTime() + 5 * 60 * 1000;
  });

  if (!addedOrders.length) {
    return { recovered: false, state: currentState, addedOrders: [], addedCustomers: [], reservationAdjustments: [] };
  }

  const state = structuredClone(currentState);
  const addedCustomers = mergeReferencedCustomers(state, attemptedState, addedOrders);
  state.orders = [...addedOrders, ...liveOrders];
  state.orderTombstones = getActiveTombstones(currentState?.orderTombstones, now);
  const reservationAdjustments = applyOrderReservationEffects(state, addedOrders);
  state.lastPrices = mergeLastPrices(currentState?.lastPrices, attemptedState?.lastPrices, addedOrders);
  state.updatedAt = now.toISOString();

  return { recovered: true, state, addedOrders, addedCustomers, reservationAdjustments };
}

export function findUnexpectedOrderRemovals(currentState, attemptedState, action, now = new Date()) {
  const currentIds = new Set(
    (Array.isArray(currentState?.orders) ? currentState.orders : [])
      .map((order) => String(order?.id || "").trim())
      .filter(Boolean),
  );
  const attemptedIds = new Set(
    (Array.isArray(attemptedState?.orders) ? attemptedState.orders : [])
      .map((order) => String(order?.id || "").trim())
      .filter(Boolean),
  );
  const permittedActions = new Set(["order-delete", "order-to-draft"]);
  const tombstonedIds = new Set(getActiveTombstones(attemptedState?.orderTombstones, now).map((entry) => entry.id));

  return [...currentIds].filter((id) => {
    if (attemptedIds.has(id)) return false;
    return !permittedActions.has(action) || !tombstonedIds.has(id);
  });
}

function mergeReferencedCustomers(state, attemptedState, addedOrders) {
  const liveCustomers = Array.isArray(state.customers) ? state.customers : [];
  const attemptedCustomers = Array.isArray(attemptedState?.customers) ? attemptedState.customers : [];
  const referencedIds = new Set(addedOrders.map((order) => String(order?.customerId || "")).filter(Boolean));
  const referencedNames = new Set(addedOrders.map((order) => cleanName(order?.customerName)).filter(Boolean));
  const liveIds = new Set(liveCustomers.map((customer) => String(customer?.id || "")).filter(Boolean));
  const liveNames = new Set(liveCustomers.map((customer) => cleanName(customer?.name)).filter(Boolean));
  const addedCustomers = attemptedCustomers.filter((customer) => {
    const id = String(customer?.id || "").trim();
    const name = cleanName(customer?.name);
    const referenced = referencedIds.has(id) || referencedNames.has(name);
    return referenced && Boolean(name) && !liveIds.has(id) && !liveNames.has(name);
  });
  if (addedCustomers.length) state.customers = [...liveCustomers, ...addedCustomers];
  return addedCustomers;
}

function getActiveTombstones(value, now) {
  const cutoff = now.getTime() - TOMBSTONE_RETENTION_MS;
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((entry) => ({
      id: String(entry?.id || "").trim(),
      deletedAt: String(entry?.deletedAt || ""),
    }))
    .filter((entry) => {
      const deletedAt = new Date(entry.deletedAt).getTime();
      if (!entry.id || !Number.isFinite(deletedAt) || deletedAt < cutoff || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
}

function applyOrderReservationEffects(state, orders) {
  const reservations = Array.isArray(state.reservations) ? state.reservations : [];
  const customers = Array.isArray(state.customers) ? state.customers : [];
  const adjustments = [];

  for (const order of orders) {
    const reservationPurchase = String(order?.orderType || "") === "reservation";
    const customer = customers.find((entry) => entry?.id === order?.customerId)
      || customers.find((entry) => cleanName(entry?.name) === cleanName(order?.customerName));
    if (!customer) continue;

    for (const item of Array.isArray(order?.items) ? order.items : []) {
      const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
      const fromReservation = Boolean(item?.fromReservation || item?.priceSource === "reservation");
      const delta = reservationPurchase ? quantity : (fromReservation ? -quantity : 0);
      if (!delta) continue;

      const skuKey = String(item?.skuKey || item?.sku || "").trim();
      if (!skuKey) continue;
      let reservation = reservations.find(
        (entry) => entry?.customerId === customer.id && String(entry?.skuKey || entry?.sku || "") === skuKey,
      );
      if (!reservation && delta > 0) {
        reservation = {
          id: `reservation-${customer.id}-${skuKey}`,
          customerId: customer.id,
          customerName: customer.name || order.customerName || "",
          skuKey,
          sku: item?.sku || skuKey,
          description: item?.description || "",
          quantity: 0,
          updatedAt: order.createdAt || new Date().toISOString(),
        };
        reservations.push(reservation);
      }
      if (!reservation) continue;

      const before = Math.max(0, Math.floor(Number(reservation.quantity) || 0));
      const after = Math.max(0, before + delta);
      reservation.quantity = after;
      reservation.updatedAt = order.createdAt || new Date().toISOString();
      adjustments.push({ orderId: String(order.id || ""), reservationId: String(reservation.id || ""), delta: after - before });
    }
  }

  state.reservations = reservations;
  return adjustments;
}

function mergeLastPrices(currentLastPrices, attemptedLastPrices, addedOrders) {
  const next = {
    ...(attemptedLastPrices && typeof attemptedLastPrices === "object" ? attemptedLastPrices : {}),
    ...(currentLastPrices && typeof currentLastPrices === "object" ? currentLastPrices : {}),
  };

  for (const order of addedOrders) {
    const savedAt = order?.updatedAt || order?.createdAt || new Date().toISOString();
    for (const item of Array.isArray(order?.items) ? order.items : []) {
      const skuKey = String(item?.skuKey || item?.sku || "").trim();
      const price = Number(item?.unitPrice);
      if (!skuKey || !Number.isFinite(price) || item?.fromReservation || item?.priceSource === "reservation" || item?.priceSource === "bonus") continue;
      const current = next[skuKey];
      if (!current || new Date(current.savedAt || 0).getTime() <= new Date(savedAt).getTime()) {
        next[skuKey] = { price, savedAt };
      }
    }
  }

  return next;
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

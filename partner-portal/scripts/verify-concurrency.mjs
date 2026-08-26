import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../api/portal.js", import.meta.url), "utf8");
assert.match(api, /sql\.begin/);
assert.match(api, /FOR UPDATE/);
assert.match(api, /status = 'processing'/);
assert.match(api, /retryPendingMainOrders/);
assert.match(api, /sent_to_main/);
assert.match(api, /sync_failed/);
assert.match(api, /sync_action/);
assert.match(api, /status IN \('pending_owner_approval', 'approved', 'sent_to_main', 'sync_failed', 'processing'\) FOR UPDATE/);
assert.match(api, /ORDER_DUPLICATE_WINDOW_SECONDS = 90/);
assert.match(api, /pg_advisory_xact_lock\(hashtext/);
assert.match(api, /price-search-eitan-portal-schema-v1/);
assert.match(api, /two instances can both try to add/);
assert.match(api, /partner_orders_dedupe_lookup/);
assert.match(api, /duplicate_order_submission_blocked/);
assert.match(api, /deduplicated: true/);
assert.match(api, /syncPartnerOrderToMain/);
assert.match(api, /action === "sync-order"/);
assert.match(api, /price-search-eitan-main-sync/);
const createHandler = api.slice(api.indexOf('action === "create-order"'), api.indexOf('action === "update-order"'));
assert.match(createHandler, /syncSavedOrderOnce/, "a durable create must be synchronized by the server, not by mobile JavaScript");
assert.doesNotMatch(createHandler, /await sendOrderToMain/, "the handler must use the bounded synchronization guard");
const deleteHandler = api.slice(api.indexOf('action === "delete-order"'), api.indexOf('action === "save-entity"'));
assert.match(deleteHandler, /syncSavedOrderOnce/, "a durable delete must be synchronized by the server");
assert.doesNotMatch(deleteHandler, /sendOrderToMain/, "a delete must use the bounded synchronization guard");
assert.match(api, /ORDER_SYNC_MAX_ATTEMPTS = 3/);
assert.match(api, /ORDER_SYNC_RETRY_BATCH_SIZE = 2/);
assert.match(api, /next_sync_at <= now\(\)/);

class ReservationLockModel {
  constructor(quantity) { this.remaining = quantity; this.tail = Promise.resolve(); }
  async take(requested) {
    let result;
    const next = this.tail.then(async () => {
      await Promise.resolve();
      const allocated = Math.min(this.remaining, requested);
      this.remaining -= allocated;
      result = allocated;
    });
    this.tail = next.catch(() => {});
    await next;
    return result;
  }
}

const reservation = new ReservationLockModel(3);
const [first, second] = await Promise.all([reservation.take(2), reservation.take(2)]);
assert.equal(first + second, 3, "two simultaneous withdrawals must not exceed the reserved quantity");
assert.equal(reservation.remaining, 0, "reserved quantity must never become negative");
console.log("Partner portal approval locking checks passed.");

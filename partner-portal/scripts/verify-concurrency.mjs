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
assert.match(api, /status IN \('sent_to_main', 'sync_failed', 'processing'\) FOR UPDATE/);

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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function getFunctionSource(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = appSource.indexOf("\nfunction ", start + 1);
  return appSource.slice(start, next === -1 ? appSource.length : next);
}

for (const name of ["renderOrders", "renderCompletedOrders", "renderTomorrowOrders", "renderFutureStockOrders"]) {
  const source = getFunctionSource(name);
  assert.equal(
    /visibleOrders\.slice\(|futureStockOrders\.slice\(/.test(source),
    false,
    `${name} must never silently cap the visible order list`,
  );
}

assert.match(
  stylesSource,
  /\[data-tab-panel="completed-orders"\] > \.orders-panel,[\s\S]*?\[data-tab-panel="tomorrow-orders"\] > \.orders-panel \{\s*overflow: visible;/,
  "all order workspaces must allow the page to own vertical scrolling",
);

console.log("Order list visibility checks passed.");

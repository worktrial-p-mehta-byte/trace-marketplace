import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, invoiceTotal, lineTax } from "../src/invoice.js";

// Finance rule: tax is rounded per line, half to even ("banker's rounding"),
// on exact cents. These expectations come from the finance team; do not change them.

test("tax rounds half to even on exact cents", () => {
  assert.equal(lineTax(1.25, 0.1), 0.12); // 12.5 cents -> 12
  assert.equal(lineTax(1.35, 0.1), 0.14); // 13.5 cents -> 14
  assert.equal(lineTax(10.05, 0.05), 0.5); // 50.25 cents -> 50
});

test("totals add exact cents", () => {
  const lines = [
    { qty: 3, price: 0.1 },
    { qty: 1, price: 0.2 },
    { qty: 7, price: 1.15 },
  ];
  assert.equal(invoiceTotal(lines, 0.1), 9.4);
});

test("large totals format with separators", () => {
  assert.equal(formatMoney(1234567.891), "$1,234,567.89");
});

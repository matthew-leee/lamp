/*
  Unit tests for lib/money.ts: integer-cents formatting in the CONFIGURED
  currency (no hardcoded symbol or currency; ENV-01/CONFIG-01).
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatMoney } from "../lib/money.ts";

test("HKD whole dollars render without minor digits", () => {
  assert.equal(formatMoney(161500, "HKD"), "HK$1,615");
  assert.equal(formatMoney(1079500, "HKD"), "HK$10,795");
  assert.equal(formatMoney(0, "HKD"), "HK$0");
});

test("HKD non-zero cents render with two minor digits", () => {
  assert.equal(formatMoney(161555, "HKD"), "HK$1,615.55");
  assert.equal(formatMoney(5, "HKD"), "HK$0.05");
  assert.equal(formatMoney(123456789, "HKD"), "HK$1,234,567.89");
});

test("thousands grouping is deterministic", () => {
  assert.equal(formatMoney(123456700, "HKD"), "HK$1,234,567");
  assert.equal(formatMoney(99999, "HKD"), "HK$999.99");
});

test("another configured currency formats with its own symbol", () => {
  assert.equal(formatMoney(161500, "USD"), "$1,615");
});

test("negative, non-integer or unsafe-integer cents throw", () => {
  assert.throws(() => formatMoney(-1, "HKD"), /must not be negative/);
  assert.throws(() => formatMoney(1.5, "HKD"), /safe integer/);
  assert.throws(() => formatMoney("161500", "HKD"), /safe integer/);
  // Beyond Number.MAX_SAFE_INTEGER: silently rounding a plausible-looking
  // price is exactly what this guard exists to prevent.
  assert.throws(() => formatMoney(2 ** 53, "HKD"), /safe integer/);
});

test("invalid currency codes throw (never a plausible price in a wrong currency)", () => {
  assert.throws(() => formatMoney(161500, "hkd"), /ISO 4217/);
  assert.throws(() => formatMoney(161500, "HKDX"), /ISO 4217/);
  assert.throws(() => formatMoney(161500, ""), /ISO 4217/);
});

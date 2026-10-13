/*
  Pure unit tests for the static catalogue (lib/catalog.ts) and the money
  helper (lib/money.ts). No server, no network: the live-availability contract
  is covered by availability.test.mjs.

  Contract asserted:
  - exactly 8 SKUs, slugs match ^[a-z0-9]+(-[a-z0-9]+)*$ (the strict subset of
    the API slug charset these slugs must satisfy)
  - prices are positive integers; units are positive integers summing to 16
  - dropNumbers are exactly 1..16 with no gaps or overlaps
  - reference prices are labelled (source, sourceUrl, checkedAt) except the
    piano SKU, which is null (TRUST-02: never invented)
  - bilingual copy is present in both languages, natural-language guarded by
    script, and free of em-dashes in user-facing strings
  - formatHKD: "HK$1,615" whole-dollar form, correct cents form, throws on
    negative or non-integer input
*/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG,
  DROP,
  getProduct,
  totalUnits,
} from "../lib/catalog.ts";
import { formatHKD } from "../lib/money.ts";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HAN_RE = /[\u4e00-\u9fff]/;
const EM_DASH_RE = /\u2014/;

/** Every user-facing string a SKU renders, in both languages. */
function userFacingStrings(sku) {
  return [
    sku.model,
    sku.modelAlt,
    sku.colourway.en,
    sku.colourway.zhHK,
    sku.heritage.en,
    sku.heritage.zhHK,
    sku.electrical.en,
    sku.electrical.zhHK,
  ];
}

test("catalogue has exactly the 8 opening-drop SKUs in table order", () => {
  assert.equal(CATALOG.length, 8);
  assert.deepEqual(
    CATALOG.map((sku) => sku.slug),
    [
      "panthella-160-v3-beige",
      "panthella-160-v3-white-opal",
      "panthella-160-v3-opal-beige-chrome",
      "panthella-160-v3-opal-pale-blue",
      "panthella-160-v3-opal-pale-rose",
      "ph-2-1-table-chrome",
      "ph-3-2-table-chrome",
      "ph-1-1-piano-table-limited",
    ],
  );
});

test("slugs match the slug pattern and are unique", () => {
  const seen = new Set();
  for (const sku of CATALOG) {
    assert.match(sku.slug, SLUG_RE, `slug ${sku.slug} must match ${SLUG_RE}`);
    assert.ok(!seen.has(sku.slug), `duplicate slug ${sku.slug}`);
    seen.add(sku.slug);
  }
});

test("brand is Louis Poulsen for every SKU", () => {
  for (const sku of CATALOG) {
    assert.equal(sku.brand, "Louis Poulsen");
  }
});

test("prices and units are positive integers", () => {
  for (const sku of CATALOG) {
    assert.ok(Number.isInteger(sku.priceCents), `${sku.slug} price integer`);
    assert.ok(sku.priceCents > 0, `${sku.slug} price positive`);
    assert.ok(Number.isInteger(sku.units), `${sku.slug} units integer`);
    assert.ok(sku.units > 0, `${sku.slug} units positive`);
  }
});

test("dropNumbers are exactly 1..16 with no gaps or overlaps", () => {
  const all = CATALOG.flatMap((sku) => sku.dropNumbers).sort((a, b) => a - b);
  assert.deepEqual(
    all,
    Array.from({ length: 16 }, (_, i) => i + 1),
    "drop numbers must cover 01-16 exactly once each",
  );
  for (const sku of CATALOG) {
    assert.equal(
      sku.dropNumbers.length,
      sku.units,
      `${sku.slug}: one drop number per unit`,
    );
    // Sequential within the SKU and strictly ascending across the table.
    assert.deepEqual(
      sku.dropNumbers,
      sku.dropNumbers.slice().sort((a, b) => a - b),
      `${sku.slug}: drop numbers in table order`,
    );
  }
  const firsts = CATALOG.map((sku) => sku.dropNumbers[0]);
  assert.deepEqual(
    firsts,
    firsts.slice().sort((a, b) => a - b),
    "SKUs must not interleave drop numbers",
  );
});

test("units sum to 16 and match DROP and totalUnits", () => {
  const sum = CATALOG.reduce((acc, sku) => acc + sku.units, 0);
  assert.equal(sum, 16);
  assert.equal(totalUnits, 16);
  assert.equal(DROP.totalPieces, 16);
  assert.equal(totalUnits, DROP.totalPieces);
});

test("reference prices are labelled, piano SKU is the only null", () => {
  for (const sku of CATALOG) {
    if (sku.slug === "ph-1-1-piano-table-limited") {
      assert.equal(sku.referencePrice, null, "piano SKU: no verified reference");
      continue;
    }
    const ref = sku.referencePrice;
    assert.ok(ref, `${sku.slug}: referencePrice required`);
    assert.ok(
      Number.isInteger(ref.minCents) && ref.minCents > 0,
      `${sku.slug}: minCents positive integer`,
    );
    assert.ok(
      Number.isInteger(ref.maxCents) && ref.maxCents > 0,
      `${sku.slug}: maxCents positive integer`,
    );
    assert.ok(ref.minCents < ref.maxCents, `${sku.slug}: minCents < maxCents`);
    assert.equal(typeof ref.source, "string");
    assert.ok(ref.source.length > 0, `${sku.slug}: source named`);
    assert.match(ref.sourceUrl, /^https:\/\//, `${sku.slug}: sourceUrl is https`);
    assert.match(ref.checkedAt, ISO_DATE_RE, `${sku.slug}: checkedAt ISO date`);
  }
});

test("copy is bilingual, marked by script, and free of em-dashes", () => {
  for (const sku of CATALOG) {
    for (const field of userFacingStrings(sku)) {
      assert.equal(typeof field, "string", `${sku.slug}: copy is a string`);
      assert.ok(field.length > 0, `${sku.slug}: copy is non-empty`);
      assert.ok(!EM_DASH_RE.test(field), `${sku.slug}: no em-dash in copy`);
    }
    for (const pair of [sku.colourway, sku.heritage, sku.electrical]) {
      assert.ok(
        HAN_RE.test(pair.zhHK),
        `${sku.slug}: zhHK copy must be Chinese script`,
      );
      assert.ok(
        !HAN_RE.test(pair.en),
        `${sku.slug}: English copy must not contain Chinese script`,
      );
    }
    assert.ok(HAN_RE.test(sku.modelAlt), `${sku.slug}: modelAlt is Chinese`);
  }
});

test("placeholder hues match the documented per-colourway values", () => {
  const expected = {
    "panthella-160-v3-beige": 35,
    "panthella-160-v3-white-opal": 40,
    "panthella-160-v3-opal-beige-chrome": 30,
    "panthella-160-v3-opal-pale-blue": 205,
    "panthella-160-v3-opal-pale-rose": 350,
    "ph-2-1-table-chrome": 210,
    "ph-3-2-table-chrome": 210,
    "ph-1-1-piano-table-limited": 45,
  };
  for (const sku of CATALOG) {
    const { hue } = sku.placeholder;
    assert.ok(Number.isInteger(hue), `${sku.slug}: hue is an integer`);
    assert.ok(hue >= 0 && hue <= 360, `${sku.slug}: hue in 0..360`);
    assert.equal(hue, expected[sku.slug], `${sku.slug}: documented hue`);
  }
});

test("getProduct resolves known slugs and rejects unknown ones", () => {
  const sku = getProduct("ph-3-2-table-chrome");
  assert.ok(sku);
  assert.equal(sku.model, "PH 3/2 Table");
  assert.equal(getProduct("no-such-lamp"), undefined);
});

test("formatHKD formats whole dollars without decimals", () => {
  assert.equal(formatHKD(161500), "HK$1,615");
  assert.equal(formatHKD(0), "HK$0");
  assert.equal(formatHKD(1000), "HK$10");
  assert.equal(formatHKD(1000000), "HK$10,000");
  assert.equal(formatHKD(12345600), "HK$123,456");
});

test("formatHKD formats non-zero cents correctly", () => {
  assert.equal(formatHKD(123456), "HK$1,234.56");
  assert.equal(formatHKD(123450), "HK$1,234.50");
  assert.equal(formatHKD(5), "HK$0.05");
  assert.equal(formatHKD(999), "HK$9.99");
});

test("formatHKD throws on negative or non-integer input", () => {
  for (const bad of [-1, -161500, 1.5, 161500.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => formatHKD(bad), RangeError, `must reject ${String(bad)}`);
  }
  for (const bad of ["100", null, undefined, 100n]) {
    assert.throws(() => formatHKD(bad), RangeError, `must reject ${String(bad)}`);
  }
});

/*
  Pure unit tests for the shared bilingual UI copy (lib/ui-copy.ts).

  Contract asserted (Vision.md I18N-01, TRUST-01, TRUST-02, commitments 5b/7):
  - drop numbering renders "Piece 03 of 16" / "Pieces 03-07 of 16" bilingually
  - reference price lines carry the source and the checked date
  - stock labels match the agreed wording and never invent a number
  - the disclosure keeps its facts (independent seller, not authorised)
  - warranty pending copy stays pending (no invented terms)
  - availability copy policy (review finding 2): the stock badge's confirmed
    state is the only per-SKU availability claim; hero copy carries the
    drop-level Hong Kong fact and product metadata is neutral
  - no em-dash (U+2014) in any user-facing string
*/

import { test } from "node:test";
import assert from "node:assert/strict";
import * as copy from "../lib/ui-copy.ts";
import { CATALOG, DROP } from "../lib/catalog.ts";

test("drop numbering: single piece -> 'Piece 03 of 16' style", () => {
  const pair = copy.dropNumbering([3], DROP.totalPieces);
  assert.equal(pair.en, "Piece 03 of 16");
  assert.equal(pair["zh-HK"], "第 03 件，共 16 件");
});

test("drop numbering: multi-unit SKU -> 'Pieces 03-07 of 16' style", () => {
  const pair = copy.dropNumbering([3, 4, 5, 6, 7], DROP.totalPieces);
  assert.equal(pair.en, "Pieces 03-07 of 16");
  assert.equal(pair["zh-HK"], "第 03-07 件，共 16 件");
});

test("drop numbering: unsorted input uses first and last piece numbers", () => {
  const pair = copy.dropNumbering([7, 3], DROP.totalPieces);
  assert.equal(pair.en, "Pieces 03-07 of 16");
});

test("drop numbering: empty input throws instead of rendering nothing", () => {
  assert.throws(() => copy.dropNumbering([], DROP.totalPieces), RangeError);
});

test("drop numbering covers the whole drop 01-16", () => {
  for (const product of CATALOG) {
    const pair = copy.dropNumbering(product.dropNumbers, DROP.totalPieces);
    assert.match(pair.en, /^Pieces? \d{2}(-\d{2})? of 16$/);
    assert.match(pair["zh-HK"], /^第 \d{2}(-\d{2})? 件，共 16 件$/);
  }
});

test("reference price range formats through formatHKD in both languages", () => {
  const pair = copy.referenceRange({
    minCents: 190000,
    maxCents: 280000,
    source: "MyConcept Hong Kong",
    sourceUrl: "https://example.invalid/x",
    checkedAt: "2026-10-12",
  });
  assert.equal(pair.en, "HK$1,900 to HK$2,800");
  assert.equal(pair["zh-HK"], "HK$1,900 至 HK$2,800");
});

test("reference checked date is labelled in both languages", () => {
  const pair = copy.referenceChecked({
    minCents: 100000,
    maxCents: 100000,
    source: "MyConcept Hong Kong",
    sourceUrl: "https://example.invalid/x",
    checkedAt: "2026-10-12",
  });
  assert.equal(pair.en, "checked 2026-10-12");
  assert.equal(pair["zh-HK"], "查核日期 2026-10-12");
});

test("stock labels: agreed wording in both languages", () => {
  assert.equal(copy.stockLeft.en(2), "2 left");
  assert.equal(copy.stockLeft["zh-HK"](2), "尚餘 2 件");
  assert.equal(copy.stockSoldOut.en, "Sold out");
  assert.equal(copy.stockSoldOut["zh-HK"], "售罄");
  assert.equal(copy.stockUnconfirmed.en, "Confirming availability");
  assert.equal(copy.stockUnconfirmed["zh-HK"], "存貨確認中");
});

test("disclosure keeps the TRUST-01 facts in both languages", () => {
  assert.match(
    copy.disclosure.en,
    /independent seller and is not an authorised Louis Poulsen dealer/,
  );
  assert.match(copy.disclosure["zh-HK"], /獨立賣家，並非 Louis Poulsen 授權經銷商/);
});

test("warranty copy is pending, with no invented terms", () => {
  assert.match(copy.warrantyPending.en, /still being finalised/);
  assert.match(copy.warrantyPending["zh-HK"], /仍在釐定中/);
  // No duration or coverage term is asserted anywhere in the pending copy.
  const both = `${copy.warrantyPending.en} ${copy.warrantyPending["zh-HK"]}`;
  assert.doesNotMatch(both, /\b\d+\s*-?\s*(month|year)s?\b/i);
});

test("hero lead states the drop-level Hong Kong fact, never per-SKU stock", () => {
  // Approved copy pins (review finding 2): the only availability-location
  // line on the site is worded about the whole opening drop.
  assert.equal(
    copy.heroLead.en,
    "Curated designer homeware. The whole opening drop is physically in Hong Kong.",
  );
  assert.equal(copy.heroLead["zh-HK"], "精選設計家居。整批首發燈飾俱在香港。");
  assert.equal(
    copy.heroLeadPaired.en,
    "HAVN, curated designer homeware. The whole opening drop is physically in Hong Kong.",
  );
  assert.equal(
    copy.heroLeadPaired["zh-HK"],
    "HAVN 精選設計家居。整批首發燈飾俱在香港。",
  );
  const both = `${copy.heroLead.en} ${copy.heroLead["zh-HK"]}`;
  assert.doesNotMatch(both, /in stock/i);
  assert.ok(!both.includes("現貨"));
  assert.doesNotMatch(both, /\b(day|days|week|weeks|hour|hours)\b/i);
});

test("product metadata description is neutral (review finding 2)", () => {
  const pair = copy.productDescription(copy.productDisplay(CATALOG[0]));
  assert.equal(
    pair.en,
    "Panthella 160 V3 Portable (Beige). A numbered piece of the HAVN opening drop of Louis Poulsen lighting. HAVN is an independent seller.",
  );
  assert.equal(
    pair["zh-HK"],
    "Panthella 160 V3 便攜檯燈（米色），HAVN 首發登場的編號 Louis Poulsen 燈飾。HAVN 為獨立賣家。",
  );
  const both = `${pair.en} ${pair["zh-HK"]}`;
  assert.doesNotMatch(both, /in stock/i);
  assert.ok(!both.includes("現貨"));
});

test("no user-facing string claims unconditional stock (review finding 2)", () => {
  // The stock badge's confirmed "N left" state (a formatter, not copy) is
  // the only per-SKU availability claim; every static string must be free of
  // unconditional "in stock" wording.
  const leaves = [];
  const walk = (value) => {
    if (typeof value === "string") leaves.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  Object.values(copy).forEach(walk);
  for (const value of leaves) {
    assert.doesNotMatch(value, /in stock/i, `unconditional stock claim: ${value}`);
    assert.ok(!value.includes("現貨"), `unconditional stock claim: ${value}`);
  }
});

test("product display names are bilingual", () => {
  const panthella = CATALOG[0];
  const pair = copy.productDisplay(panthella);
  assert.equal(pair.en, "Panthella 160 V3 Portable (Beige)");
  assert.equal(pair["zh-HK"], "Panthella 160 V3 便攜檯燈（米色）");
});

test("enquiry message names the product in both languages", () => {
  const subject = copy.productDisplay(CATALOG[0]);
  const message = copy.enquiryMessage(subject);
  assert.match(message, /Panthella 160 V3 Portable \(Beige\)/);
  assert.match(message, /Panthella 160 V3 便攜檯燈（米色）/);
});

test("reference pending copy says verification pending, invents nothing", () => {
  assert.match(copy.referencePending.en, /verification pending/i);
  assert.match(copy.referencePending["zh-HK"], /核實中/);
  const both = `${copy.referencePending.en} ${copy.referencePending["zh-HK"]}`;
  assert.doesNotMatch(both, /MyConcept/);
  assert.doesNotMatch(both, /HK\$/);
});

test("no em-dash (U+2014) in any user-facing string", () => {
  // The copy module exports nested Bilingual objects, so walk recursively to
  // reach every leaf string.
  const leaves = [];
  const walk = (value) => {
    if (typeof value === "string") leaves.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  Object.values(copy).forEach(walk);
  assert.ok(leaves.length > 10, "expected the copy module to export strings");
  for (const value of leaves) {
    assert.ok(
      !value.includes("\u2014"),
      `em-dash in user-facing string: ${value}`,
    );
  }
});

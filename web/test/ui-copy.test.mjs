/*
  Unit tests for lib/ui-copy.ts (D1): the chrome labels stay in code; every
  brand-bearing passage now comes from site content, so the formatters are
  tested over fixture data (test/fixtures/seed.mjs mirrors the seed).

  Display rule (I18N-01, founder 2026-10-14): SINGLE-LOCALE. The label maps
  are DATA (one entry per configured locale); pick() is THE single-locale
  reader and nothing builds a both-locales rendering pair.
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  artLabel,
  buildEnquiryMessage,
  dropNumbering,
  pick,
  productDisplay,
  productMetaDescription,
  referenceChecked,
  referenceRange,
  stockLeft,
  stockSoldOut,
  stockUnconfirmed,
} from "../lib/ui-copy.ts";

import {
  BRAND,
  CATALOGUE,
  SITE_CONTENT,
  fixtureProductDisplay,
} from "./fixtures/seed.mjs";

const PANTHELLA = CATALOGUE[0];
const PIANO = CATALOGUE.find((p) => p.slug === "ph-1-1-piano-table-limited");

test("chrome labels carry every configured locale as DATA (rendering picks one)", async () => {
  const copy = await import("../lib/ui-copy.ts");
  for (const key of [
    "navMainLabel",
    "navHome",
    "backToDrop",
    "priceLabel",
    "disclosureLabel",
    "trustStripLabel",
    "warrantyLabel",
    "referenceLabel",
    "referenceSourceLabel",
    "electricalLabel",
    "heritageLabel",
    "enquiryButtonLabel",
    "lightsToggleLabel",
    "stockSoldOut",
    "stockUnconfirmed",
  ]) {
    const label = copy[key];
    assert.equal(typeof label.en, "string", `${key}.en`);
    assert.equal(typeof label["zh-HK"], "string", `${key}[zh-HK]`);
    assert.notEqual(label.en, "");
    assert.notEqual(label["zh-HK"], "");
  }
});

test("brand-bearing passages are absent from the chrome module (data now)", async () => {
  const copy = await import("../lib/ui-copy.ts");
  for (const key of [
    "heroEyebrow",
    "heroLead",
    "heroLeadPaired",
    "dropFraming",
    "disclosure",
    "warrantyPending",
    "referencePending",
    "enquiryIntro",
    "enquiryMessage",
    "dropEnquirySubject",
    "productDescription",
  ]) {
    assert.equal(copy[key], undefined, `${key} must have moved to site content`);
  }
});

test("pick reads a locale and falls back to the first defined entry", () => {
  const labels = { en: "Home", "zh-HK": "首頁" };
  assert.equal(pick(labels, "en"), "Home");
  assert.equal(pick(labels, "zh-HK"), "首頁");
  // A locale without its own label falls back instead of rendering blank.
  assert.equal(pick(labels, "fr"), "Home");
});

test("stockLeft is the per-locale confirmed-count label map (read one via pick)", () => {
  const labels = stockLeft(2);
  assert.equal(labels.en, "2 left");
  assert.equal(labels["zh-HK"], "尚餘 2 件");
  // The badge renders the CHOSEN locale's label only (single-locale display).
  assert.equal(pick(stockLeft(2), "en"), "2 left");
  assert.equal(pick(stockLeft(2), "zh-HK"), "尚餘 2 件");
});

test("productDisplay composes model + colourway per locale from data", () => {
  assert.equal(productDisplay(PANTHELLA, "en"), "Panthella 160 V3 Portable (Beige)");
  assert.equal(
    productDisplay(PANTHELLA, "zh-HK"),
    "Panthella 160 V3 便攜檯燈（米色）",
  );
  // Independent fixture derivation agrees (fixture mirrors the seed).
  for (const locale of ["en", "zh-HK"]) {
    assert.equal(productDisplay(PANTHELLA, locale), fixtureProductDisplay(PANTHELLA, locale));
  }
});

test("dropNumbering renders single pieces and ranges per locale", () => {
  assert.equal(dropNumbering([10], 16, "en"), "Piece 10 of 16");
  assert.equal(dropNumbering([10], 16, "zh-HK"), "第 10 件，共 16 件");
  assert.equal(dropNumbering([3, 4, 5, 6, 7], 16, "en"), "Pieces 03-07 of 16");
  assert.equal(dropNumbering([3, 4, 5, 6, 7], 16, "zh-HK"), "第 03-07 件，共 16 件");
  // Unsorted input is normalized (contiguous run stays a range).
  assert.equal(dropNumbering([5, 3, 4], 16, "en"), "Pieces 03-05 of 16");
  // Non-contiguous sets render as an explicit list: a span must never
  // claim pieces the SKU does not own (review finding).
  assert.equal(dropNumbering([3, 7], 16, "en"), "Pieces 03, 07 of 16");
  assert.equal(dropNumbering([3, 7], 16, "zh-HK"), "第 03, 07 件，共 16 件");
  assert.throws(() => dropNumbering([], 16, "en"), /must not be empty/);
  assert.throws(() => dropNumbering([1], 0, "en"), /positive integer/);
});

test("referenceRange and referenceChecked render amounts and dates", () => {
  const reference = PANTHELLA.referencePrice;
  assert.equal(referenceRange(reference, "HKD", "en"), "HK$1,900 to HK$2,800");
  assert.equal(referenceRange(reference, "HKD", "zh-HK"), "HK$1,900 至 HK$2,800");
  assert.equal(referenceChecked(reference, "en"), "checked 2026-10-12");
  assert.equal(referenceChecked(reference, "zh-HK"), "查核日期 2026-10-12");
});

test("artLabel composes the accessible name in the chosen locale", () => {
  assert.equal(artLabel("The lamp", "en"), "Placeholder artwork for The lamp");
  assert.equal(artLabel("這盞燈", "zh-HK"), "這盞燈 的暫代圖片");
});

test("buildEnquiryMessage renders the chosen locale's template with the brand", () => {
  assert.equal(
    buildEnquiryMessage(SITE_CONTENT, BRAND, "the drop", "en"),
    `Hi ${BRAND}, I would like to ask about the drop.`,
  );
  assert.equal(
    buildEnquiryMessage(SITE_CONTENT, BRAND, "首發系列", "zh-HK"),
    `你好 ${BRAND}，我想查詢 首發系列。`,
  );
});

test("productMetaDescription renders the template per locale, neutral claims", () => {
  const en = productMetaDescription(SITE_CONTENT, BRAND, "PH 2/1 Table (Chrome)", "en");
  assert.equal(
    en,
    "PH 2/1 Table (Chrome). A numbered piece of the HVILE opening drop of Louis Poulsen lighting. HVILE is an independent seller.",
  );
  const zh = productMetaDescription(SITE_CONTENT, BRAND, "PH 2/1 檯燈（鍍鉻）", "zh-HK");
  assert.equal(
    zh,
    "PH 2/1 檯燈（鍍鉻），HVILE 首發登場的編號 Louis Poulsen 燈飾。HVILE 為獨立賣家。",
  );
  // The piano SKU has no verified reference price (fixture: null).
  assert.equal(PIANO.referencePrice, null);
});

test("stock badge labels: every state is single-language per locale (pick)", () => {
  // Review gap (single-locale display): pin the CHOSEN-locale label for all
  // three badge states, so no state can ever render the alt language's text.
  assert.equal(pick(stockLeft(3), "en"), "3 left");
  assert.equal(pick(stockLeft(3), "zh-HK"), "尚餘 3 件");
  assert.equal(pick(stockSoldOut, "en"), "Sold out");
  assert.equal(pick(stockSoldOut, "zh-HK"), "售罄");
  assert.equal(pick(stockUnconfirmed, "en"), "Confirming availability");
  assert.equal(pick(stockUnconfirmed, "zh-HK"), "存貨確認中");
  // None of the en labels contains Han characters and none of the zh
  // labels contains the en text (single-language per label).
  for (const label of [pick(stockLeft(2), "en"), pick(stockSoldOut, "en"), pick(stockUnconfirmed, "en")]) {
    assert.ok(!/[\u3400-\u9fff]/.test(label), `en label must stay English: ${label}`);
  }
  for (const label of [pick(stockLeft(2), "zh-HK"), pick(stockSoldOut, "zh-HK"), pick(stockUnconfirmed, "zh-HK")]) {
    assert.ok(!/Sold out|left|Confirming/.test(label), `zh label must stay Chinese: ${label}`);
  }
});

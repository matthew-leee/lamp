/*
  Unit tests for lib/ui-copy.ts (D1): the chrome labels stay in code; every
  brand-bearing passage now comes from site content, so the formatters are
  tested over fixture data (test/fixtures/seed.mjs mirrors the seed).
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  artLabel,
  buildEnquiryMessage,
  dropNumbering,
  formatBoth,
  pick,
  productDisplay,
  productMetaDescription,
  referenceChecked,
  referenceRange,
  stockLeftPair,
} from "../lib/ui-copy.ts";

import {
  BRAND,
  CATALOGUE,
  SITE_CONTENT,
  fixtureProductDisplay,
} from "./fixtures/seed.mjs";

const PANTHELLA = CATALOGUE[0];
const PIANO = CATALOGUE.find((p) => p.slug === "ph-1-1-piano-table-limited");

test("chrome labels carry both locales at equal weight", async () => {
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

test("formatBoth applies a formatter in both locales", () => {
  const pair = stockLeftPair(2);
  assert.equal(pair.en, "2 left");
  assert.equal(pair["zh-HK"], "尚餘 2 件");
  assert.equal(formatBoth(stockLeftPair ? { en: (n) => `${n}!` } : {}, 1).en, "1!");
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

test("dropNumbering renders single pieces and ranges in both locales", () => {
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

test("artLabel composes the accessible name per locale", () => {
  const subject = { en: "The lamp", "zh-HK": "這盞燈" };
  assert.equal(artLabel(subject, "en"), "Placeholder artwork for The lamp");
  assert.equal(artLabel(subject, "zh-HK"), "這盞燈 的暫代圖片");
});

test("buildEnquiryMessage renders both templates with the brand", () => {
  const subject = { en: "the drop", "zh-HK": "首發系列" };
  const message = buildEnquiryMessage(SITE_CONTENT, BRAND, subject);
  assert.equal(
    message,
    `Hi ${BRAND}, I would like to ask about the drop.\n\n你好 ${BRAND}，我想查詢 首發系列。`,
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

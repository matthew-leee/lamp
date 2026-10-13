/*
  Unit tests for lib/catalog-client.ts (DATA-02, D1): the build-time data
  client. Fail-LOUD contract (the opposite of the fail-closed availability
  channel): malformed data throws, never renders invented content. All
  fetches are injected; no network.
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contentValue,
  fetchCatalogue,
  fetchSettings,
  fetchSiteContent,
  getProduct,
} from "../lib/catalog-client.ts";

const API = "http://api.test";

/** A JSON Response stub. */
const json = (body, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

/** A minimal valid API catalogue row (snake_case, as the Rust API serves). */
const apiProduct = {
  slug: "panthella-160-v3-beige",
  brand: "Louis Poulsen",
  model: "Panthella 160 V3 Portable",
  price_cents: 161500,
  family: "panthella-160-portable",
  active: true,
  art_variant: "dome",
  art_hue: 35,
  content: {
    en: { colourway: "Beige" },
    "zh-HK": { model_alt: "Panthella 160 V3 便攜檯燈", colourway: "米色" },
  },
  reference_price: {
    min_price_cents: 190000,
    max_price_cents: 280000,
    source_name: "MyConcept Hong Kong",
    source_url: "https://www.myconcept.com.hk/products/panthella-160-portable-table-lamp",
    checked_on: "2026-10-12",
  },
  pieces: [1, 2],
  units_in_drop: 2,
};

const apiCatalogue = (products = [apiProduct]) => ({
  total_pieces: products.reduce((sum, p) => sum + p.pieces.length, 0),
  products,
});

test("valid catalogue maps to camelCase with no stock fields", async () => {
  const catalogue = await fetchCatalogue(API, () => json(apiCatalogue()));
  assert.equal(catalogue.totalPieces, 2);
  assert.equal(catalogue.products.length, 1);
  const product = catalogue.products[0];
  assert.equal(product.slug, "panthella-160-v3-beige");
  assert.equal(product.priceCents, 161500);
  assert.equal(product.art.variant, "dome");
  assert.equal(product.art.hue, 35);
  assert.equal(product.content["zh-HK"].modelAlt, "Panthella 160 V3 便攜檯燈");
  assert.equal(product.referencePrice.sourceName, "MyConcept Hong Kong");
  assert.equal(product.referencePrice.checkedOn, "2026-10-12");
  assert.deepEqual(product.pieces, [1, 2]);
  assert.equal(product.unitsInDrop, 2);
  // Stock never appears in the catalogue (the availability channel owns it).
  assert.ok(!("stockTotal" in product));
  assert.ok(!("stockReserved" in product));
  assert.equal(getProduct(catalogue, "panthella-160-v3-beige").slug, product.slug);
  assert.equal(getProduct(catalogue, "nope"), undefined);
});

test("null reference price maps to null (verification pending)", async () => {
  const catalogue = await fetchCatalogue(API, () =>
    json(apiCatalogue([{ ...apiProduct, slug: "s", reference_price: null }])),
  );
  assert.equal(catalogue.products[0].referencePrice, null);
});

test("pieces are sorted ascending regardless of API order", async () => {
  const catalogue = await fetchCatalogue(API, () =>
    json(apiCatalogue([{ ...apiProduct, pieces: [7, 3, 5], units_in_drop: 3 }])),
  );
  assert.deepEqual(catalogue.products[0].pieces, [3, 5, 7]);
});

test("empty catalogue throws (no active products = nothing to generate)", async () => {
  await assert.rejects(
    () => fetchCatalogue(API, () => json(apiCatalogue([]))),
    /catalogue is empty/,
  );
});

test("non-200 and network failures throw with the URL in the message", async () => {
  await assert.rejects(
    () => fetchCatalogue(API, () => json({ error: "database not configured: set DATABASE_URL" }, 503)),
    /HTTP 503/,
  );
  await assert.rejects(
    () => fetchCatalogue(API, () => Promise.reject(new Error("boom"))),
    /catalog-client: GET .* failed/,
  );
});

test("malformed rows throw, never render invented data", async () => {
  for (const bad of [
    { ...apiProduct, slug: 42 },
    { ...apiProduct, price_cents: "161500" },
    { ...apiProduct, pieces: "1,2" },
    { ...apiProduct, art_variant: "triangle" },
    { ...apiProduct, art_hue: -1 },
    { ...apiProduct, reference_price: { min_price_cents: 1 } },
  ]) {
    await assert.rejects(
      () => fetchCatalogue(API, () => json(apiCatalogue([bad]))),
      /catalog-client/,
      `expected malformed row to throw: ${JSON.stringify(bad).slice(0, 80)}`,
    );
  }
});

test("missing products array throws", async () => {
  await assert.rejects(
    () => fetchCatalogue(API, () => json({ total_pieces: 2 })),
    /no products array/,
  );
});

test("site content nests key -> locale -> value", async () => {
  const content = await fetchSiteContent(API, () =>
    json({
      content: {
        "hero.eyebrow": { en: "The opening drop", "zh-HK": "首發登場" },
        "trust.disclosure": { en: "{brand} is an independent seller." },
      },
    }),
  );
  assert.equal(content["hero.eyebrow"].en, "The opening drop");
  assert.equal(content["trust.disclosure"].en, "{brand} is an independent seller.");
});

test("settings map flat; non-string values are dropped", async () => {
  const settings = await fetchSettings(API, () =>
    json({ "brand.name": "HVILE", "currency": "HKD" }),
  );
  assert.deepEqual(settings, { "brand.name": "HVILE", currency: "HKD" });
  await assert.rejects(
    () => fetchSettings(API, () => json(["not", "an", "object"])),
    /settings response is not a flat object/,
  );
});

test("contentValue is fail-loud on missing key, missing locale AND blank copy", () => {
  const content = { key: { en: "value" }, blank: { en: "   " } };
  assert.equal(contentValue(content, "key", "en"), "value");
  assert.throws(() => contentValue(content, "missing", "en"), /site content key "missing"/);
  assert.throws(() => contentValue(content, "key", "zh-HK"), /no value for locale "zh-HK"/);
  // Blank rows are present-but-empty: not renderable copy (review finding:
  // empty trust copy must fail the build, not render empty passages).
  assert.throws(() => contentValue(content, "blank", "en"), /is blank/);
});

test("blank product copy fields throw instead of rendering empty passages", async () => {
  const blankColourway = { ...apiProduct, content: { en: { colourway: "   " } } };
  await assert.rejects(
    () => fetchCatalogue(API, () => json(apiCatalogue([blankColourway]))),
    /blank colourway/,
  );
  const blankModelAlt = {
    ...apiProduct,
    content: { "zh-HK": { model_alt: "" } },
  };
  await assert.rejects(
    () => fetchCatalogue(API, () => json(apiCatalogue([blankModelAlt]))),
    /blank model_alt/,
  );
});

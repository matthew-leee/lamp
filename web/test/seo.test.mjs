/*
  Unit tests for lib/seo.ts (T4): absolute URLs, canonical/hreflang maps and
  Product JSON-LD. Expectations are independent literals/fixtures (never
  derived from the code under test beyond the pure inputs).
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  absoluteUrl,
  alternatesFor,
  localeUrl,
  productJsonLd,
  productUrl,
} from "../lib/seo.ts";
import { requiredSiteUrl, resolveSiteConfig, validGaId } from "../lib/config.ts";
import { locales } from "../lib/i18n.ts";
import { CATALOGUE, BRAND } from "./fixtures/seed.mjs";

const SITE = "https://shop.example.com";
const ALT_SITE = "https://shop.example.com/";

const PANTHELLA = CATALOGUE[0];

/** A resolved config against a synthetic settings override map. */
function configWith(overrides = {}) {
  return resolveSiteConfig({ "brand.name": BRAND, ...overrides });
}

test("absoluteUrl joins without duplicate slashes", () => {
  assert.equal(absoluteUrl(SITE, "/en"), "https://shop.example.com/en");
  assert.equal(absoluteUrl(ALT_SITE, "en/products/x"), "https://shop.example.com/en/products/x");
  assert.equal(absoluteUrl("https://shop.example.com///", "/x"), "https://shop.example.com/x");
});

test("localeUrl and productUrl build the route shapes", () => {
  assert.equal(localeUrl(SITE, "en"), "https://shop.example.com/en");
  assert.equal(
    productUrl(SITE, "zh-HK", "panthella-160-v3-beige"),
    "https://shop.example.com/zh-HK/products/panthella-160-v3-beige",
  );
});

test("alternatesFor: canonical = the page's own URL; hreflang + x-default", () => {
  const { canonical, languages } = alternatesFor(
    configWith({ "site.url": SITE }),
    "products/x",
    "zh-HK",
  );
  assert.equal(canonical, "https://shop.example.com/zh-HK/products/x");
  assert.equal(Object.keys(languages).length, 3);
  assert.equal(languages.en, "https://shop.example.com/en/products/x");
  assert.equal(languages["zh-Hant-HK"], "https://shop.example.com/zh-HK/products/x");
  assert.equal(languages["x-default"], "https://shop.example.com/en/products/x");
  // Home pages: no trailing path.
  const home = alternatesFor(configWith({ "site.url": SITE }), "", "en");
  assert.equal(home.canonical, "https://shop.example.com/en");
  assert.equal(home.languages["zh-Hant-HK"], "https://shop.example.com/zh-HK");
});

test("productJsonLd: name, sku, brand, absolute url, price string, currency; NO availability", () => {
  const config = configWith({ currency: "HKD", "site.url": SITE });
  const ld = productJsonLd({ product: PANTHELLA, locale: locales[0], config });
  assert.equal(ld["@context"], "https://schema.org");
  assert.equal(ld["@type"], "Product");
  assert.equal(ld.name, "Panthella 160 V3 Portable (Beige)");
  assert.equal(ld.sku, "panthella-160-v3-beige");
  assert.deepEqual(ld.brand, { "@type": "Brand", name: "Louis Poulsen" });
  const offers = ld.offers;
  assert.equal(offers["@type"], "Offer");
  assert.equal(
    offers.url,
    "https://shop.example.com/en/products/panthella-160-v3-beige",
  );
  // Integer-math price string, never a float (money is integer cents).
  assert.equal(offers.price, "1615.00");
  assert.equal(offers.priceCurrency, "HKD");
  // Availability is deliberately omitted: an unconfirmed stock claim in
  // SSR HTML is forbidden by commitment 5b.
  assert.equal("availability" in offers, false);
  assert.equal(JSON.stringify(ld).includes("availability"), false);
});

test("productJsonLd price pads minor digits (non-zero cents, integer math)", () => {
  const config = configWith({ currency: "HKD", "site.url": SITE });
  const odd = { ...PANTHELLA, priceCents: 161555 };
  const ld = productJsonLd({ product: odd, locale: locales[0], config });
  assert.equal(ld.offers.price, "1615.55");
  assert.equal(typeof ld.offers.price, "string");
});

test("requiredSiteUrl: fail-loud when the canonical URL is unset", () => {
  const config = resolveSiteConfig({ "brand.name": BRAND });
  assert.equal(config.siteUrl, null);
  assert.throws(() => requiredSiteUrl(config), /canonical site URL is required/);
  const withUrl = resolveSiteConfig({ "brand.name": BRAND, "site.url": SITE });
  assert.equal(requiredSiteUrl(withUrl), SITE);
});

test("validGaId: only G-XXXX shapes pass; anything else is OFF", () => {
  assert.equal(validGaId("G-ABC123DEFG"), "G-ABC123DEFG");
  assert.equal(validGaId(" G-ABC123DEFG "), "G-ABC123DEFG"); // trimmed
  assert.equal(validGaId(null), null);
  assert.equal(validGaId(""), null);
  assert.equal(validGaId("UA-12345678-1"), null); // not a GA4 id
  assert.equal(validGaId("G-abc!"), null); // invalid characters
  assert.equal(validGaId("G-12"), null); // too short
  // Resolve-level: an invalid configured id resolves to null (GA off), so a
  // stray string from settings never reaches a script URL.
  const config = resolveSiteConfig({
    "brand.name": BRAND,
    "analytics.ga_measurement_id": "not-a-ga-id",
  });
  assert.equal(config.gaMeasurementId, null);
  const configGood = resolveSiteConfig({
    "brand.name": BRAND,
    "analytics.ga_measurement_id": "G-ABC123DEFG",
  });
  assert.equal(configGood.gaMeasurementId, "G-ABC123DEFG");
});
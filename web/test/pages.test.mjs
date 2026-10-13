/*
  Behavioral tests for the storefront pages (homepage + all 8 product story
  pages, both locales) against a production server spawned on a random test
  port. Requires a prior `npm run build` with the API + seeded DB reachable
  and NEXT_PUBLIC_BRAND_NAME set to the fixture brand (documented in
  web/README.md and test/fixtures/seed.mjs).

  Contract asserted (Vision.md DROP-01, TRUST-01, TRUST-02, I18N-01 and
  commitments 5b / 7):
  - ALL 8 slugs x both locales (16 pages) get the core trust assertions:
    exact approved copy from the seed fixture (company copy lives in the
    database since D1; the fixture is the independent pin) is rendered; the
    independent-seller disclosure appears at least TWICE per language (trust
    block + footer); the warranty block region contains the exact approved
    pending copy and NO other sentence; labelled reference price carries its
    rendered amounts, source and checked date (or verification pending);
    stock badges show the "Confirming availability" placeholder and NO
    stock number in the SSR HTML (commitment 5b); no unconditional "in stock"
    claim anywhere (review finding 2); no delivery duration in either
    language (commitment 7); no em-dashes.
  - every rendered HK$ amount is whitelisted per page (price plus, where
    verified, the labelled reference range): a fabricated comparison price
    fails the set equality. The PH 1/1 Piano page must show exactly
    {HK$10,795} and nothing else.
  - the PH 2/1 page renders HK$8,400 and HK$9,400 with "MyConcept Hong
    Kong" and "2026-10-12" (reference amounts, source, checked date).
  - the homepage lists all 8 SKUs, pins the hero/trust copy and carries the
    drop-level "whole drop physically in Hong Kong" fact (the only such line
    on the site).

  Server identity: the port is randomized (distinct range from
  test/routes.test.mjs), readiness is taken from the child's own "Ready"
  output, child output is captured for diagnostics on failure, and shutdown
  is awaited. The child env has NEXT_PUBLIC_WHATSAPP_NUMBER removed so the
  "render nothing" WhatsApp branch is guaranteed regardless of the shell
  environment (NEXT_PUBLIC_ values are also inlined at build time, so the
  build must run without a WhatsApp number too). Stock numbers cannot leak
  into SSR HTML regardless of env: badges fetch /api/availability
  client-side only.

  Deliberate-mutation note (tight by construction): deleting the trust-block
  disclosure div makes the "disclosure at least twice per language" count drop
  to 1 (footer only) and fail; the warranty region is compared for exact
  equality; currency amounts are compared as an exact set. Assertions are
  written so those mutations cannot pass by accident.
*/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as copy from "../lib/ui-copy.ts";
import {
  BRAND,
  CATALOGUE,
  SITE_CONTENT,
  TOTAL_PIECES,
  fixtureDropNumbering,
  fixtureMoney,
  fixtureProductDisplay,
  fixtureReferenceChecked,
  fixtureReferenceRange,
  render,
  siteContent,
} from "./fixtures/seed.mjs";

/* ---------------------------------------------------------------- */
/* APPROVED TRUST COPY (rendered with the fixture brand). Independent */
/* literals: expectations must NOT be derived from the production copy  */
/* path. Since D1 the copy is seeded site_content; these literals are   */
/* the reviewable pin of what the baked pages must render.            */
/* ---------------------------------------------------------------- */
const APPROVED = {
  disclosure: {
    en: "HVILE is an independent seller and is not an authorised Louis Poulsen dealer. All trademarks belong to their owners.",
    "zh-HK":
      "HVILE 為獨立賣家，並非 Louis Poulsen 授權經銷商。所有商標均屬其擁有者。",
  },
  warrantyPending: {
    en: "HVILE gives its own warranty on every piece it sells. The exact terms are still being finalised and will be published here before the first sale, in HVILE wording. The Louis Poulsen manufacturer warranty is never quoted as the HVILE warranty.",
    "zh-HK":
      "HVILE 為所售出的每件燈飾提供自家保養。具體條款仍在釐定中，將以 HVILE 自己的用詞於首宗銷售前在此公佈。Louis Poulsen 的原廠保養絕不會被引用為 HVILE 的保養條款。",
  },
  referencePending: {
    en: "Reference price: verification pending. A comparison price is published here only once a real source has been checked and the check date recorded.",
    "zh-HK":
      "參考價：核實中。只有在核實真實來源並記錄查核日期後，比較價才會在此公佈。",
  },
};

test("approved trust copy is pinned: the fixture template renders to the literal", () => {
  // The fixture templates (independent literals) rendered with the brand
  // must equal the APPROVED pin: a quiet edit on either side fails loudly.
  for (const [key, approved] of Object.entries({
    "trust.disclosure": APPROVED.disclosure,
    "warranty.pending": APPROVED.warrantyPending,
    "reference.pending": APPROVED.referencePending,
  })) {
    for (const locale of ["en", "zh-HK"]) {
      assert.equal(
        render(SITE_CONTENT[key][locale]),
        approved[locale],
        `${key} [${locale}] must render to the approved literal`,
      );
    }
  }
});

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
const port = 6200 + Math.floor(Math.random() * 800);
const base = `http://127.0.0.1:${port}`;

let server;
let serverOut = "";
let serverErr = "";

before(async () => {
  const env = { ...process.env };
  // The spawned server renders regenerations at request time (60s fetch
  // leases since T4) and reads the brand/site-URL config dynamically from
  // process.env at RUNTIME — pin it instead of trusting the ambient shell:
  // a brand-less shell made every regen throw and race 404s whenever this
  // suite ran more than 60s after the build. (NEXT_PUBLIC_API_URL was
  // previously DELETED here — a no-op for the built server, since the
  // statically accessed value is inlined at build; setting it documents the
  // gate's build value.) The API + seeded DB must be reachable as for
  // `npm run build`, because regens fetch live.
  env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  env.NEXT_PUBLIC_BRAND_NAME = BRAND;
  env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:18080";
  delete env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  server = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: webRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (serverOut += d));
  server.stderr.on("data", (d) => (serverErr += d));

  const deadline = Date.now() + 30_000;
  while (!serverOut.includes("Ready")) {
    if (server.exitCode !== null) {
      throw new Error(
        `next start exited early (code ${server.exitCode}). stdout:\n${serverOut}\nstderr:\n${serverErr}`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `next start not ready within 30s. stdout:\n${serverOut}\nstderr:\n${serverErr}`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(async () => {
  if (!server || server.exitCode !== null) return;
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill(signal);
    const confirmed = await Promise.race([
      exited.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 5000)),
    ]);
    if (confirmed || server.exitCode !== null) return;
  }
  throw new Error(
    `test server (pid ${server.pid}) did not exit after SIGTERM and SIGKILL. stdout:\n${serverOut}\n--- next server stderr ---\n${serverErr}`,
  );
});

/** Run a test body; on any failure, attach the captured server output. */
async function check(fn) {
  try {
    await fn();
  } catch (err) {
    throw new Error(
      `${err?.message ?? err}\n--- next server stdout ---\n${serverOut}\n--- next server stderr ---\n${serverErr}`,
      { cause: err },
    );
  }
}

async function get(pathname) {
  const res = await fetch(`${base}${pathname}`);
  return { status: res.status, html: await res.text() };
}

/** Rendered HTML with <script> blocks and React comment separators removed. */
function visible(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--.*?-->/g, "");
}

/** Occurrences of `needle` in `haystack`. */
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** Tag-stripped, whitespace-normalised text of an HTML fragment. */
function textOf(fragment) {
  return fragment.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** The nearest enclosing <div>...</div> region around `text`. */
function enclosingDiv(body, text) {
  const i = body.indexOf(text);
  assert.ok(i >= 0, `expected "${text.slice(0, 60)}..." in body`);
  const start = body.lastIndexOf("<div", i);
  const end = body.indexOf("</div>", i);
  assert.ok(start >= 0 && end > start, `no enclosing <div> around "${text.slice(0, 60)}..."`);
  return body.slice(start, end);
}

/* ---------------------------------------------------------------- */
/* Patterns that must never appear                                   */
/* ---------------------------------------------------------------- */

/* Stock numbers in SSR HTML (commitment 5b: SSR never renders stock
   numbers; the live counts are confirmed client-side). */
const stockNumberPatterns = [
  /\b\d+\s+left\b/, // "2 left"
  /\d+\s*left</, // "2 left</span" (digit before "left</")
  /尚餘\s*\d+\s*件/, // "尚餘 2 件"
  /sold\s*out/i,
  /售罄/,
];

/* Unconditional availability claims (review finding 2). */
const inStockPatterns = [/in stock/i, /現貨/];

/* Drop-level location fact (allowed on the homepage hero only). */
const dropLevelPatterns = [/physically in Hong Kong/i, /俱在香港/];

/* Delivery durations and promises in both languages (commitment 7). */
const deliveryPatterns = [
  /\b\d+\s*-?\s*(business |working |calendar )?(day|days|week|weeks|hour|hours|minute|minutes)\b/i,
  /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*-?\s*(business |working |calendar )?(day|days|week|weeks|hour|hours)\b/i,
  /\b(next|same)[- ]day\b/i,
  /(deliver|ship|dispatch|arriv)[a-z]*\s+(within|in)\s+\d/i,
  /deliver(ed|y)?[^.]{0,30}(tomorrow|next day|next-day|today|tonight)/i,
  /ship(ped|s|ping)?[^.]{0,30}(tomorrow|today|tonight)/i,
  /delivery[^.]{0,30}(day|hour|minute)/i,
  /shipping[^.]{0,30}(day|hour|minute)/i,
  /工作日/,
  /工作天/,
  /日內送/,
  /送貨時間/,
  /翌日送達/,
  /即日送達/,
  /明日送貨/,
  /送達/,
];

/* Positive matcher fixtures: every ban pattern must catch the promise it
   exists for (so a weakened pattern fails loudly). */
const deliveryFixtures = [
  "Delivery in 3 days",
  "two-day delivery",
  "next-day delivery",
  "same day dispatch",
  "Delivered tomorrow",
  "Ships tomorrow",
  "delivery within 24 hours",
  "五個工作天內送到",
  "翌日送達",
  "即日送達",
  "明日送貨",
  "即日送達府上",
];

test("every delivery-promise ban pattern catches its fixture", () => {
  for (const fixture of deliveryFixtures) {
    const hits = deliveryPatterns.filter((pattern) => pattern.test(fixture));
    assert.ok(
      hits.length > 0,
      `no delivery ban pattern catches the fixture: "${fixture}"`,
    );
  }
});

/* Invented warranty terms that must never appear (founder open item). */
const inventedTermPattern =
  /\b(one|two|three|four|five|six|twelve|\d+)\s*[- ]\s*(month|year)s?\b/i;

/* ---------------------------------------------------------------- */
/* Core trust assertions, run for ALL 8 slugs x 2 locales            */
/* ---------------------------------------------------------------- */

function assertCoreProductPage({ html, product, locale }) {
  const alt = locale === "en" ? "zh-HK" : "en";
  const docLang = locale === "en" ? "en" : "zh-Hant-HK";
  const name = fixtureProductDisplay(product, locale);
  const body = visible(html);

  // Document language and the exact approved title/metadata copy.
  assert.match(html, new RegExp(`<html lang="${docLang}"`));
  const expectedTitle = `${name} | ${BRAND}`;
  assert.ok(
    html.includes(`<title>${expectedTitle}`),
    `expected <title> to start with "${expectedTitle}"`,
  );
  // Metadata is neutral (review finding 2): exact approved description, and
  // no unconditional stock claim in any metadata.
  const expectedDescription = render(
    SITE_CONTENT["meta.product.descriptionTemplate"][locale],
    { subject: name },
  );
  const meta = html.match(/<meta name="description" content="([^"]*)"/);
  assert.equal(
    meta?.[1],
    expectedDescription,
    `expected meta description "${expectedDescription}", got "${meta?.[1]}"`,
  );

  // Price in confident numerals, in the configured currency.
  const price = fixtureMoney(product.priceCents);
  assert.ok(body.includes(price), `expected ${price} in body`);

  // Currency whitelist: every rendered HK$ amount must be the price or a
  // labelled reference amount. A fabricated comparison price fails this
  // exact set equality.
  const amounts = [...new Set(body.match(/HK\$[\d,]+(?:\.\d{2})?/g) ?? [])].sort();
  const expectedAmounts = new Set([price]);
  if (product.referencePrice !== null) {
    expectedAmounts.add(fixtureMoney(product.referencePrice.minPriceCents));
    expectedAmounts.add(fixtureMoney(product.referencePrice.maxPriceCents));
  }
  assert.deepEqual(
    amounts,
    [...expectedAmounts].sort(),
    "rendered currency amounts must be exactly the whitelisted set",
  );

  // Drop numbering (DROP-01), both languages, exact approved strings.
  const piecesLocale = fixtureDropNumbering(product.pieces, TOTAL_PIECES, locale);
  const piecesAlt = fixtureDropNumbering(product.pieces, TOTAL_PIECES, alt);
  assert.ok(body.includes(piecesLocale), `missing "${piecesLocale}"`);
  assert.ok(body.includes(piecesAlt), `missing "${piecesAlt}"`);

  // (a) Independent-seller disclosure (TRUST-01), exact approved strings, at
  // least TWICE per language: trust block + footer.
  for (const [langKey, passage] of [
    ["en", APPROVED.disclosure.en],
    ["zh-HK", APPROVED.disclosure["zh-HK"]],
  ]) {
    const seen = count(body, passage);
    assert.ok(
      seen >= 2,
      `disclosure (${langKey}) must appear at least twice (trust block + footer), found ${seen}`,
    );
  }
  assert.ok(body.includes(copy.disclosureLabel[locale]));
  assert.ok(body.includes(copy.disclosureLabel[alt]));

  // (b) Warranty: exact approved pending copy and NO other sentence in the
  // warranty block region (tight region comparison).
  const warrantyRegion = enclosingDiv(body, APPROVED.warrantyPending.en);
  assert.equal(
    textOf(warrantyRegion),
    `${copy.warrantyLabel[locale]} / ${copy.warrantyLabel[alt]} ` +
      `${APPROVED.warrantyPending[locale]} ${APPROVED.warrantyPending[alt]}`,
    "the warranty block must contain exactly the approved label and pending copy",
  );
  assert.doesNotMatch(body, inventedTermPattern);

  // (c) Labelled reference price (TRUST-02): rendered amounts, source and
  // checked date, or the exact pending copy and never a fabricated figure.
  assert.ok(body.includes(copy.referenceLabel[locale]));
  assert.ok(body.includes(copy.referenceLabel[alt]));
  const reference = product.referencePrice;
  if (reference === null) {
    assert.ok(
      body.includes(APPROVED.referencePending.en),
      "missing English pending copy",
    );
    assert.ok(
      body.includes(APPROVED.referencePending["zh-HK"]),
      "missing Chinese pending copy",
    );
    assert.doesNotMatch(body, /MyConcept/);
    assert.doesNotMatch(body, /checked \d{4}-\d{2}-\d{2}/);
    assert.doesNotMatch(body, /查核日期\s*\d{4}-\d{2}-\d{2}/);
  } else {
    const rangeLocale = fixtureReferenceRange(reference, "HKD", locale);
    const rangeAlt = fixtureReferenceRange(reference, "HKD", alt);
    const checkedLocale = fixtureReferenceChecked(reference, locale);
    const checkedAlt = fixtureReferenceChecked(reference, alt);
    assert.ok(body.includes(rangeLocale), `missing "${rangeLocale}"`);
    assert.ok(body.includes(rangeAlt), `missing "${rangeAlt}"`);
    assert.ok(body.includes(checkedLocale), `missing "${checkedLocale}"`);
    assert.ok(body.includes(checkedAlt), `missing "${checkedAlt}"`);
    assert.ok(body.includes(reference.sourceName), "missing reference source");
  }

  // (d) Availability (commitment 5b): the SSR HTML shows the confirming
  // placeholder and NEVER a stock number.
  assert.ok(
    body.includes(copy.stockUnconfirmed.en),
    "missing 'Confirming availability' placeholder",
  );
  assert.ok(
    body.includes(copy.stockUnconfirmed["zh-HK"]),
    "missing Chinese confirming placeholder",
  );
  for (const pattern of stockNumberPatterns) {
    assert.doesNotMatch(body, pattern);
  }

  // Review finding 2: no unconditional "in stock" claim anywhere on a
  // product page, and the drop-level Hong Kong fact stays on the homepage.
  for (const pattern of [...inStockPatterns, ...dropLevelPatterns]) {
    assert.doesNotMatch(body, pattern);
  }

  // Commitment 7: no delivery duration in either language.
  for (const pattern of deliveryPatterns) {
    assert.doesNotMatch(body, pattern);
  }

  // (e) Electrical and heritage copy from the catalogue, exact strings.
  assert.ok(body.includes(product.electrical[locale]));
  assert.ok(body.includes(product.electrical[alt]));
  assert.ok(body.includes(copy.electricalLabel[locale]));
  assert.ok(body.includes(copy.heritageLabel[locale]));
  assert.ok(body.includes(product.heritage[locale]));

  // Other approved chrome copy, exact strings.
  assert.ok(body.includes(copy.backToDrop[locale]));
  assert.ok(body.includes(copy.backToDrop[alt]));
  assert.ok(body.includes(copy.priceLabel[locale]));
  assert.ok(body.includes(copy.priceLabel[alt]));

  // Signature interaction: the only client-side control on the page.
  assert.match(body, /<button[^>]*aria-pressed="(true|false)"/);
  assert.match(body, /<button[^>]*aria-label="[^"]*Lights[^"]*燈[^"]*"/);

  // WhatsApp entry renders nothing without a confirmed number.
  assert.doesNotMatch(body, /wa\.me/);

  // No em-dash anywhere in user-facing copy.
  assert.doesNotMatch(body, /\u2014/);
}

for (const product of CATALOGUE) {
  for (const locale of ["en", "zh-HK"]) {
    test(`/products/${product.slug} (${locale}): core trust contract`, () =>
      check(async () => {
        const { status, html } = await get(`/${locale}/products/${product.slug}`);
        assert.equal(status, 200);
        assertCoreProductPage({ html, product, locale });
      }));
  }
}

/* ---------------------------------------------------------------- */
/* Focused pins: reference amounts and the currency whitelist        */
/* ---------------------------------------------------------------- */

for (const locale of ["en", "zh-HK"]) {
  test(`/products/ph-2-1-table-chrome (${locale}): rendered reference amounts, source, checked date`, () =>
    check(async () => {
      const { html } = await get(`/${locale}/products/ph-2-1-table-chrome`);
      const body = visible(html);
      assert.ok(body.includes("HK$8,400"), "missing HK$8,400");
      assert.ok(body.includes("HK$9,400"), "missing HK$9,400");
      assert.ok(body.includes("MyConcept Hong Kong"), "missing reference source");
      assert.ok(body.includes("2026-10-12"), "missing reference checked date");
    }));

  test(`/products/ph-1-1-piano-table-limited (${locale}): exactly {HK$10,795}, no fabricated comparison`, () =>
    check(async () => {
      const { html } = await get(`/${locale}/products/ph-1-1-piano-table-limited`);
      const body = visible(html);
      const amounts = [...new Set(body.match(/HK\$[\d,]+(?:\.\d{2})?/g) ?? [])];
      assert.deepEqual(amounts, ["HK$10,795"]);
      assert.ok(body.includes(APPROVED.referencePending.en));
      assert.ok(body.includes(APPROVED.referencePending["zh-HK"]));
      assert.doesNotMatch(body, /MyConcept/);
      assert.ok(!body.includes("2026-10-12"), "fabricated check date in body");
    }));

  test(`/products/unknown-slug (${locale}): 404 from the global shell`, () =>
    check(async () => {
      const { status, html } = await get(`/${locale}/products/not-a-lamp`);
      assert.equal(status, 404);
      assert.match(html, /<html lang="en"/);
      assert.doesNotMatch(visible(html), /Louis Poulsen dealer/);
    }));
}

/* ---------------------------------------------------------------- */
/* Homepage                                                          */
/* ---------------------------------------------------------------- */

for (const locale of ["en", "zh-HK"]) {
  test(`homepage (${locale}): the 8 pieces, pinned trust copy, neutral metadata`, () =>
    check(async () => {
      const alt = locale === "en" ? "zh-HK" : "en";
      const docLang = locale === "en" ? "en" : "zh-Hant-HK";
      const { status, html } = await get(`/${locale}`);
      assert.equal(status, 200);
      const body = visible(html);
      assert.match(html, new RegExp(`<html lang="${docLang}"`));

      // Exact approved metadata (neutral, no "in stock" claim).
      assert.ok(html.includes(`<title>${siteContent("meta.home.title", locale)}`));
      const meta = html.match(/<meta name="description" content="([^"]*)"/);
      assert.equal(meta?.[1], siteContent("meta.home.description", locale));

      // All 8 SKUs are linked into their story pages, exactly once each.
      const links = body.match(new RegExp(`href="/${locale}/products/`, "g"));
      assert.equal(
        links?.length,
        8,
        `expected 8 product links, got ${links?.length ?? 0}`,
      );
      for (const product of CATALOGUE) {
        assert.ok(
          body.includes(`href="/${locale}/products/${product.slug}"`),
          `missing link to ${product.slug}`,
        );
      }

      // Currency whitelist: exactly the 8 catalogue prices, nothing else.
      const amounts = [...new Set(body.match(/HK\$[\d,]+(?:\.\d{2})?/g) ?? [])].sort();
      const expectedPrices = [
        ...new Set(CATALOGUE.map((p) => fixtureMoney(p.priceCents))),
      ].sort();
      assert.deepEqual(amounts, expectedPrices);

      // Hero lead, exact approved strings (review finding 2: the drop-level
      // "whole drop physically in Hong Kong" fact lives here only).
      assert.ok(body.includes(siteContent("hero.lead", locale)), "missing hero lead");
      assert.ok(
        body.includes(siteContent("hero.leadPaired", alt)),
        "missing paired lead",
      );
      assert.ok(
        body.includes(siteContent("drop.framing", locale)),
        "missing drop framing",
      );
      assert.ok(body.includes(siteContent("drop.framing", alt)));

      // Collection heading pair, both languages (I18N-01), from site content.
      assert.ok(body.includes(siteContent("drop.piecesHeading", locale)));
      assert.ok(
        body.includes(siteContent("drop.piecesHeading", alt)),
        "missing alt collection heading",
      );

      // Trust strip + footer: disclosure at least twice per language.
      for (const passage of [APPROVED.disclosure.en, APPROVED.disclosure["zh-HK"]]) {
        assert.ok(
          count(body, passage) >= 2,
          "disclosure must appear at least twice (trust strip + footer)",
        );
      }
      assert.ok(body.includes(copy.trustStripLabel[locale]));
      assert.ok(body.includes(siteContent("enquiry.intro", locale)));
      assert.ok(body.includes(siteContent("enquiry.intro", alt)));

      // Footer location from site content with the brand.
      assert.ok(body.includes(`${BRAND} · ${siteContent("footer.location", locale)}`));

      // Unconfirmed stock everywhere, no numbers (commitment 5b).
      assert.ok(body.includes(copy.stockUnconfirmed.en));
      assert.ok(body.includes(copy.stockUnconfirmed["zh-HK"]));
      for (const pattern of stockNumberPatterns) {
        assert.doesNotMatch(body, pattern);
      }

      // No unconditional "in stock" claim, no delivery duration (commitment 7).
      for (const pattern of [...inStockPatterns, ...deliveryPatterns]) {
        assert.doesNotMatch(body, pattern);
      }

      // WhatsApp entry renders nothing without a confirmed number.
      assert.doesNotMatch(body, /wa\.me/);
      assert.doesNotMatch(body, /\u2014/);
    }));
}

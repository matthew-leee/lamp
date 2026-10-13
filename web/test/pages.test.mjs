/*
  Behavioral tests for the T3 storefront pages (homepage + all 8 product
  story pages, both locales) against a production server spawned on a random
  test port. Requires a prior `npm run build` (documented in web/README.md).

  Contract asserted (Vision.md DROP-01, TRUST-01, TRUST-02, I18N-01 and
  commitments 5b / 7, reviewer send-back T3-rework):
  - ALL 8 slugs x both locales (16 pages) get the core trust assertions:
    exact approved copy imported from lib/ui-copy.ts is rendered; the
    independent-seller disclosure appears at least TWICE per language (trust
    block + footer); the warranty block region contains the exact approved
    pending copy and NO other sentence; labelled reference price carries its
    rendered amounts, source and checked date (or verification pending);
    stock badges show the "Confirming availability" placeholder and NO stock
    number in the SSR HTML (commitment 5b: SSR never renders stock numbers);
    no unconditional "in stock" claim anywhere (review finding 2); no
    delivery duration in either language (commitment 7); no em-dashes.
  - every rendered HK$ amount is whitelisted per page (price plus, where
    verified, the labelled reference range): a fabricated comparison price
    fails the set equality. The PH 1/1 Piano page must therefore show exactly
    {HK$10,795} and nothing else.
  - the PH 2/1 page renders HK$8,400 and HK$9,400 with "MyConcept Hong
    Kong" and "2026-10-12" (reference amounts, source, checked date).
  - the homepage lists all 8 SKUs, pins the hero/trust copy and carries the
    drop-level "whole drop physically in Hong Kong" fact (the only such line
    on the site).
  - unknown slugs 404 from the global shell without executing the page.

  Server identity: the port is randomized (distinct range from
  test/routes.test.mjs so the two spawned servers cannot collide), readiness
  is taken from the child's own "Ready" output line, child output is captured
  for diagnostics on failure, and shutdown is awaited. The child env has
  NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WHATSAPP_NUMBER removed so the
  "render nothing" WhatsApp branch is guaranteed regardless of the shell
  environment (NEXT_PUBLIC_ values are also inlined at build time, so the
  build must run with them unset too). Stock numbers cannot leak into SSR
  HTML regardless of env: badges fetch /api/availability client-side only.

  Deliberate-mutation demonstration (deliberate-mutation demos were run in
  T1; this file is tight by construction, and one mutation was verified
  manually during T3-rework): commenting out the trust-block disclosure
  <div> in app/[lang]/products/[slug]/page.tsx and rebuilding makes the
  "disclosure appears at least twice per language" count drop to 1 (footer
  only) and fail exactly that assertion; the warranty-region exact-text
  assertion also fails if anything is added inside the warranty block, and
  the currency whitelist fails if any amount is fabricated. Assertions are
  written so those mutations cannot pass by accident: counts are >= 2 per
  language, the warranty region is compared for exact text equality, and
  rendered amounts are compared as an exact set.
*/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOG, DROP } from "../lib/catalog.ts";
import { formatHKD } from "../lib/money.ts";
import * as copy from "../lib/ui-copy.ts";

/* ---------------------------------------------------------------- */
/* APPROVED TRUST COPY FIXTURES (review finding 3, T3-rework-2).     */
/* Independent literals: expectations must NOT be derived from the   */
/* production copy module, otherwise a quiet edit to production copy */
/* (e.g. appending "Lifetime parts and labour are covered.") would  */
/* update the expectation at the same time. The pinning test below   */
/* fails the moment production copy drifts from these literals, and  */
/* any change here is a visible, reviewable decision.                */
/* ---------------------------------------------------------------- */
const APPROVED = {
  disclosure: {
    en: "HAVN is an independent seller and is not an authorised Louis Poulsen dealer. All trademarks belong to their owners.",
    "zh-HK":
      "HAVN 為獨立賣家，並非 Louis Poulsen 授權經銷商。所有商標均屬其擁有者。",
  },
  warrantyPending: {
    en: "HAVN gives its own warranty on every piece it sells. The exact terms are still being finalised and will be published here before the first sale, in HAVN wording. The Louis Poulsen manufacturer warranty is never quoted as the HAVN warranty.",
    "zh-HK":
      "HAVN 為所售出的每件燈飾提供自家保養。具體條款仍在釐定中，將以 HAVN 自己的用詞於首宗銷售前在此公佈。Louis Poulsen 的原廠保養絕不會被引用為 HAVN 的保養條款。",
  },
  referencePending: {
    en: "Reference price: verification pending. A comparison price is published here only once a real source has been checked and the check date recorded.",
    "zh-HK":
      "參考價：核實中。只有在核實真實來源並記錄查核日期後，比較價才會在此公佈。",
  },
};

test("approved trust copy is pinned to independent literals", () => {
  assert.equal(copy.disclosure.en, APPROVED.disclosure.en);
  assert.equal(copy.disclosure["zh-HK"], APPROVED.disclosure["zh-HK"]);
  assert.equal(copy.warrantyPending.en, APPROVED.warrantyPending.en);
  assert.equal(
    copy.warrantyPending["zh-HK"],
    APPROVED.warrantyPending["zh-HK"],
  );
  assert.equal(copy.referencePending.en, APPROVED.referencePending.en);
  assert.equal(
    copy.referencePending["zh-HK"],
    APPROVED.referencePending["zh-HK"],
  );
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
  delete env.NEXT_PUBLIC_API_URL;
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
    `test server (pid ${server.pid}) did not exit after SIGTERM and SIGKILL. stdout:\n${serverOut}\nstderr:\n${serverErr}`,
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

/** Rendered HTML with every <script> block removed (no RSC payload noise). */
function visible(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, "");
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

/* Unconditional availability claims (review finding 2): the confirmed
   badge state is the only per-SKU claim. */
const inStockPatterns = [/in stock/i, /現貨/];

/* Drop-level location fact (allowed on the homepage hero only). */
const dropLevelPatterns = [/physically in Hong Kong/i, /俱在香港/];

/* Delivery durations and promises in both languages (commitment 7: none is
   decided). Includes word-number durations and Chinese promise phrases
   (review finding 3, T3-rework-2). */
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
   exists for, so a weakened or rotten pattern fails loudly (review finding,
   T3 round 4). These strings must never appear in production copy. */
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
  const name = copy.productDisplay(product);
  const body = visible(html);

  // Document language and the exact approved title/metadata copy.
  assert.match(html, new RegExp(`<html lang="${docLang}"`));
  const expectedTitle = `${copy.pick(name, locale)} | HAVN`;
  assert.ok(
    html.includes(`<title>${expectedTitle}`),
    `expected <title> to start with "${expectedTitle}"`,
  );
  // Metadata is neutral (review finding 2): exact approved description, and
  // no unconditional stock claim in any metadata.
  const expectedDescription = copy.pick(copy.productDescription(name), locale);
  const meta = html.match(/<meta name="description" content="([^"]*)"/);
  assert.equal(
    meta?.[1],
    expectedDescription,
    `expected meta description "${expectedDescription}", got "${meta?.[1]}"`,
  );

  // Price in confident numerals, from formatHKD.
  const price = formatHKD(product.priceCents);
  assert.ok(body.includes(price), `expected ${price} in body`);

  // Currency whitelist (review finding 3): every rendered HK$ amount must be
  // the price or a labelled reference amount. A fabricated comparison price
  // fails this exact set equality.
  const amounts = [...new Set(body.match(/HK\$[\d,]+(?:\.\d{2})?/g) ?? [])].sort();
  const expectedAmounts = new Set([price]);
  if (product.referencePrice !== null) {
    expectedAmounts.add(formatHKD(product.referencePrice.minCents));
    expectedAmounts.add(formatHKD(product.referencePrice.maxCents));
  }
  assert.deepEqual(
    amounts,
    [...expectedAmounts].sort(),
    "rendered currency amounts must be exactly the whitelisted set",
  );

  // Drop numbering (DROP-01), both languages, exact approved strings.
  const pieces = copy.dropNumbering(product.dropNumbers, DROP.totalPieces);
  assert.ok(body.includes(pieces[locale]), `missing "${pieces[locale]}"`);
  assert.ok(body.includes(pieces[alt]), `missing "${pieces[alt]}"`);

  // (a) Independent-seller disclosure (TRUST-01), exact approved strings, at
  // least TWICE per language: trust block + footer. Deleting the trust-block
  // instance must fail this (see the deliberate-mutation note above).
  for (const [langKey, passage] of [
    ["en", copy.disclosure.en],
    ["zh-HK", copy.disclosure["zh-HK"]],
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
  // warranty block region (tight region comparison, review finding 3).
  const warrantyRegion = enclosingDiv(body, copy.warrantyPending.en);
  assert.equal(
    textOf(warrantyRegion),
    `${copy.warrantyLabel[locale]} / ${copy.warrantyLabel[alt]} ` +
      `${copy.warrantyPending[locale]} ${copy.warrantyPending[alt]}`,
    "the warranty block must contain exactly the approved label and pending copy",
  );
  assert.doesNotMatch(body, inventedTermPattern);

  // (c) Labelled reference price (TRUST-02): rendered amounts, source and
  // checked date, or the exact pending copy and never a fabricated figure.
  assert.ok(body.includes(copy.referenceLabel[locale]));
  assert.ok(body.includes(copy.referenceLabel[alt]));
  const reference = product.referencePrice;
  if (reference === null) {
    assert.ok(body.includes(copy.referencePending.en), "missing English pending copy");
    assert.ok(
      body.includes(copy.referencePending["zh-HK"]),
      "missing Chinese pending copy",
    );
    assert.doesNotMatch(body, /MyConcept/);
    assert.doesNotMatch(body, /checked \d{4}-\d{2}-\d{2}/);
    assert.doesNotMatch(body, /查核日期\s*\d{4}-\d{2}-\d{2}/);
  } else {
    const range = copy.referenceRange(reference);
    const checked = copy.referenceChecked(reference);
    assert.ok(body.includes(range[locale]), `missing "${range[locale]}"`);
    assert.ok(body.includes(range[alt]), `missing "${range[alt]}"`);
    assert.ok(body.includes(checked[locale]), `missing "${checked[locale]}"`);
    assert.ok(body.includes(checked[alt]), `missing "${checked[alt]}"`);
    assert.ok(body.includes(reference.source), "missing reference source");
  }

  // (d) Availability (commitment 5b, review finding 1): the SSR HTML shows
  // the confirming placeholder and NEVER a stock number. The badge's live
  // "N left" state is rendered only client-side after /api/availability
  // confirms it.
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
  // product page (metadata included), and the drop-level Hong Kong fact
  // stays on the homepage hero only.
  for (const pattern of [...inStockPatterns, ...dropLevelPatterns]) {
    assert.doesNotMatch(body, pattern);
  }

  // Commitment 7: no delivery duration in either language.
  for (const pattern of deliveryPatterns) {
    assert.doesNotMatch(body, pattern);
  }

  // (e) Electrical and heritage copy from the catalogue, exact strings.
  const electrical = copy.localizedToBilingual(product.electrical);
  const heritage = copy.localizedToBilingual(product.heritage);
  assert.ok(body.includes(electrical[locale]));
  assert.ok(body.includes(electrical[alt]));
  assert.ok(body.includes(copy.electricalLabel[locale]));
  assert.ok(body.includes(copy.heritageLabel[locale]));
  assert.ok(body.includes(heritage[locale]));

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

for (const product of CATALOG) {
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
      // The rendered reference amounts (not just "a range exists").
      assert.ok(body.includes("HK$8,400"), "missing HK$8,400");
      assert.ok(body.includes("HK$9,400"), "missing HK$9,400");
      assert.ok(body.includes("MyConcept Hong Kong"), "missing reference source");
      assert.ok(body.includes("2026-10-12"), "missing reference checked date");
    }));

  test(`/products/ph-1-1-piano-table-limited (${locale}): exactly {HK$10,795}, no fabricated comparison`, () =>
    check(async () => {
      const { html } = await get(`/${locale}/products/ph-1-1-piano-table-limited`);
      const body = visible(html);
      // Whitelist: the ONLY currency amount on the page is its own price.
      const amounts = [...new Set(body.match(/HK\$[\d,]+(?:\.\d{2})?/g) ?? [])];
      assert.deepEqual(amounts, ["HK$10,795"]);
      // Pending copy instead of a made-up comparison price.
      assert.ok(body.includes(copy.referencePending.en));
      assert.ok(body.includes(copy.referencePending["zh-HK"]));
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

/* Site metadata copy (app/[lang]/layout.tsx generateMetadata), pinned
   literally: it is layout-owned copy and must stay neutral (review finding
   2). The drop-level fact is whole-drop wording and cannot read as per-SKU
   availability. */
const siteMeta = {
  en: {
    title: "HAVN | Curated designer homeware, the opening drop",
    description:
      "HAVN, curated designer homeware. The opening drop of designer lighting: 16 numbered pieces, the whole drop physically in Hong Kong.",
  },
  "zh-HK": {
    title: "HAVN | 精選設計家居 · 首發登場",
    description: "HAVN 精選設計家居。設計燈飾首發登場，16 件編號作品，整批俱在香港。",
  },
};

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
      assert.ok(html.includes(`<title>${siteMeta[locale].title}`));
      const meta = html.match(/<meta name="description" content="([^"]*)"/);
      assert.equal(meta?.[1], siteMeta[locale].description);

      // All 8 SKUs are linked into their story pages, exactly once each.
      const links = body.match(new RegExp(`href="/${locale}/products/`, "g"));
      assert.equal(
        links?.length,
        8,
        `expected 8 product links, got ${links?.length ?? 0}`,
      );
      for (const product of CATALOG) {
        assert.ok(
          body.includes(`href="/${locale}/products/${product.slug}"`),
          `missing link to ${product.slug}`,
        );
      }

      // Currency whitelist: exactly the 8 catalogue prices, nothing else.
      const amounts = [...new Set(body.match(/HK\$[\d,]+(?:\.\d{2})?/g) ?? [])].sort();
      const expectedPrices = [
        ...new Set(CATALOG.map((p) => formatHKD(p.priceCents))),
      ].sort();
      assert.deepEqual(amounts, expectedPrices);

      // Hero lead, exact approved strings (review finding 2: the drop-level
      // "whole drop physically in Hong Kong" fact lives here only).
      assert.ok(body.includes(copy.heroLead[locale]), "missing hero lead");
      assert.ok(body.includes(copy.heroLeadPaired[alt]), "missing paired lead");
      assert.ok(
        body.includes(copy.pick(copy.dropFraming, locale)),
        "missing drop framing",
      );
      assert.ok(body.includes(copy.dropFraming[alt]));

      // Collection heading pair, both languages (I18N-01).
      assert.ok(body.includes(copy.piecesHeading[locale]));
      assert.ok(body.includes(copy.piecesHeading[alt]));

      // Trust strip + footer: disclosure at least twice per language.
      for (const passage of [copy.disclosure.en, copy.disclosure["zh-HK"]]) {
        assert.ok(
          count(body, passage) >= 2,
          "disclosure must appear at least twice (trust strip + footer)",
        );
      }
      assert.ok(body.includes(copy.pick(copy.trustStripLabel, locale)));
      assert.ok(body.includes(copy.enquiryIntro[locale]));
      assert.ok(body.includes(copy.enquiryIntro[alt]));

      // Unconfirmed stock everywhere, no numbers (commitment 5b).
      assert.ok(body.includes(copy.stockUnconfirmed.en));
      assert.ok(body.includes(copy.stockUnconfirmed["zh-HK"]));
      for (const pattern of stockNumberPatterns) {
        assert.doesNotMatch(body, pattern);
      }

      // No unconditional "in stock" claim anywhere (homepage included), and
      // no delivery duration in either language (commitment 7).
      for (const pattern of [...inStockPatterns, ...deliveryPatterns]) {
        assert.doesNotMatch(body, pattern);
      }

      // WhatsApp entry renders nothing without a confirmed number.
      assert.doesNotMatch(body, /wa\.me/);
      assert.doesNotMatch(body, /\u2014/);
    }));
}

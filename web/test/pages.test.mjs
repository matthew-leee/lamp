/*
  Behavioral tests for the storefront pages (homepage + all 8 product story
  pages, both locales) against a production server spawned on a random test
  port. Requires a prior `npm run build` with the API + seeded DB reachable
  and NEXT_PUBLIC_BRAND_NAME set to the fixture brand (documented in
  web/README.md and test/fixtures/seed.mjs).

  Contract asserted (Vision.md DROP-01, TRUST-01, TRUST-02, I18N-01 as
  re-decided by the founder 2026-10-14, and commitments 5b / 7):
  - SINGLE-LOCALE DISPLAY: every passage renders ONLY the chosen locale's
    text (one passage per key, lang attribute correct) and the ALT locale's
    approved copy is ABSENT from the rendered HTML (the key regression: the
    old paired-equal-weight display is retired and must never return).
  - ALL 8 slugs x both locales (16 pages) get the core trust assertions:
    exact approved copy from the seed fixture (company copy lives in the
    database since D1; the fixture is the independent pin) is rendered; the
    independent-seller disclosure appears at least TWICE in the chosen
    language (trust block + footer); the warranty block region contains the
    exact approved pending copy and NO other sentence; labelled reference
    price carries its rendered amounts, source and checked date (or
    verification pending); stock badges show the "Confirming availability"
    placeholder and NO stock number in the SSR HTML (commitment 5b); no
    unconditional "in stock" claim anywhere (review finding 2); no delivery
    duration in either language (commitment 7); no em-dashes.
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
  disclosure div makes the "disclosure at least twice" count drop to 1
  (footer only) and fail; the warranty region is compared for exact
  equality; currency amounts are compared as an exact set; and re-pairing
  any passage with its ALT-language twin fails the ABSENCE assertions.
  Assertions are written so those mutations cannot pass by accident.
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
  CURRENCY,
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

/** RegExp-escape a literal string. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---------------------------------------------------------------- */
/* SINGLE-LOCALE ABSENCE SETS (I18N-01, founder 2026-10-14): every    */
/* approved ALT-locale string must be ABSENT from the chosen locale's */
/* rendered HTML. The language switcher endonyms (languageNames:       */
/* "English" / "繁體中文") are the ONE allowed both-locales control and */
/* are deliberately NOT in these sets.                                */
/* ---------------------------------------------------------------- */

/** The other locale of the default pair (fixture pages are en / zh-HK). */
function altOf(locale) {
  return locale === "en" ? "zh-HK" : "en";
}

/** Chrome labels present on every storefront page (chosen locale only). */
const CHROME_LABEL_KEYS = [
  "navMainLabel",
  "navHome",
  "languageLabel",
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
  "artPlaceholderNote",
  "stockUnconfirmed",
];

/** Every approved ALT-locale chrome label (absence set). */
function altChrome(locale) {
  return CHROME_LABEL_KEYS.map((key) => copy[key][altOf(locale)]);
}

/** Every approved ALT-locale string on the homepage (absence set). */
function altHomeCopy(locale) {
  const alt = altOf(locale);
  return [
    ...[
      "meta.home.title",
      "meta.home.description",
      "hero.eyebrow",
      "hero.lead",
      "hero.leadPaired",
      "drop.framing",
      "drop.piecesHeading",
      "enquiry.intro",
      "enquiry.dropSubject",
      "footer.location",
    ].map((key) => siteContent(key, alt)),
    APPROVED.disclosure[alt],
    // Product tiles: every ALT-locale display name and drop-numbering run
    // must be absent from the chosen-locale homepage too (review gap: the
    // tile copy was outside the old absence set — a reintroduced dual tile
    // would have escaped).
    ...CATALOGUE.map((product) => fixtureProductDisplay(product, alt)),
    ...CATALOGUE.map((product) =>
      fixtureDropNumbering(product.pieces, product.pieces.length, alt),
    ),
    ...altChrome(locale),
  ];
}

/** Every approved ALT-locale string on one product page (absence set). */
function altProductCopy(locale, product) {
  const alt = altOf(locale);
  const strings = [
    APPROVED.disclosure[alt],
    APPROVED.warrantyPending[alt],
    APPROVED.referencePending[alt],
    product.electrical[alt],
    product.heritage[alt],
    fixtureProductDisplay(product, alt),
    fixtureDropNumbering(product.pieces, TOTAL_PIECES, alt),
    ...altChrome(locale),
  ];
  if (product.referencePrice !== null) {
    strings.push(
      fixtureReferenceRange(product.referencePrice, CURRENCY, alt),
      fixtureReferenceChecked(product.referencePrice, alt),
    );
  }
  return strings;
}

/** Assert `strings` are all absent from `body` (the single-locale rule). */
function assertAltAbsent(body, strings, page) {
  for (const s of strings) {
    if (s === "") continue;
    assert.ok(
      !body.includes(s),
      `${page} must NOT render the ALT locale's copy: "${s.slice(0, 60)}"`,
    );
  }
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

  // Drop numbering (DROP-01), the chosen language only, exact approved
  // string; the alt-language numbering never renders.
  const piecesLocale = fixtureDropNumbering(product.pieces, TOTAL_PIECES, locale);
  assert.ok(body.includes(piecesLocale), `missing "${piecesLocale}"`);

  // (a) Independent-seller disclosure (TRUST-01), exact approved string, at
  // least TWICE in the chosen language: trust block + footer.
  const seen = count(body, APPROVED.disclosure[locale]);
  assert.ok(
    seen >= 2,
    `disclosure must appear at least twice (trust block + footer), found ${seen}`,
  );
  assert.ok(body.includes(copy.disclosureLabel[locale]));
  // Language of parts (WCAG 3.1.2): the passage carries its lang attribute.
  assert.match(
    body,
    new RegExp(
      `<p[^>]*lang="${docLang}"[^>]*>\\s*${escapeRegExp(APPROVED.disclosure[locale])}`,
    ),
  );

  // (b) Warranty: exact approved pending copy and NO other sentence in the
  // warranty block region (tight region comparison, chosen language only).
  const warrantyRegion = enclosingDiv(body, APPROVED.warrantyPending[locale]);
  assert.equal(
    textOf(warrantyRegion),
    `${copy.warrantyLabel[locale]} ${APPROVED.warrantyPending[locale]}`,
    "the warranty block must contain exactly the approved label and pending copy",
  );
  assert.doesNotMatch(body, inventedTermPattern);

  // (c) Labelled reference price (TRUST-02): rendered amounts, source and
  // checked date in the chosen language, or the exact pending copy and never
  // a fabricated figure.
  assert.ok(body.includes(copy.referenceLabel[locale]));
  const reference = product.referencePrice;
  if (reference === null) {
    assert.ok(
      body.includes(APPROVED.referencePending[locale]),
      "missing chosen-locale pending copy",
    );
    assert.doesNotMatch(body, /MyConcept/);
    assert.doesNotMatch(body, /checked \d{4}-\d{2}-\d{2}/);
    assert.doesNotMatch(body, /查核日期\s*\d{4}-\d{2}-\d{2}/);
  } else {
    const rangeLocale = fixtureReferenceRange(reference, CURRENCY, locale);
    const checkedLocale = fixtureReferenceChecked(reference, locale);
    assert.ok(body.includes(rangeLocale), `missing "${rangeLocale}"`);
    assert.ok(body.includes(checkedLocale), `missing "${checkedLocale}"`);
    assert.ok(body.includes(reference.sourceName), "missing reference source");
    // Language of parts: the English source name keeps its own lang attribute
    // inside the chosen-language passage (WCAG 3.1.2).
    assert.match(
      body,
      new RegExp(
        `<a[^>]*lang="en"[^>]*>${escapeRegExp(reference.sourceName)}</a>`,
      ),
    );
  }

  // (d) Availability (commitment 5b): the SSR HTML shows the CHOSEN locale's
  // confirming placeholder and NEVER a stock number.
  assert.ok(
    body.includes(copy.stockUnconfirmed[locale]),
    "missing the chosen locale's confirming placeholder",
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

  // (e) Electrical and heritage copy from the catalogue, exact strings,
  // chosen language only.
  assert.ok(body.includes(product.electrical[locale]));
  assert.ok(body.includes(copy.electricalLabel[locale]));
  assert.ok(body.includes(copy.heritageLabel[locale]));
  assert.ok(body.includes(product.heritage[locale]));
  // Language of parts on the catalogue passages.
  assert.match(
    body,
    new RegExp(
      `<p[^>]*lang="${docLang}"[^>]*>\\s*${escapeRegExp(product.electrical[locale])}`,
    ),
  );

  // Other approved chrome copy, exact strings, chosen language only.
  assert.ok(body.includes(copy.backToDrop[locale]));
  assert.ok(body.includes(copy.priceLabel[locale]));

  // One home link label in the chosen locale (the nav renders the chosen
  // language only).
  assert.ok(
    body.includes(`<span lang="${docLang}">${copy.navHome[locale]}</span>`),
    "home link label must render in the chosen locale",
  );

  // THE KEY REGRESSION (founder 2026-10-14): the ALT locale's approved copy
  // must be ABSENT — no passage renders the other language.
  assertAltAbsent(body, altProductCopy(locale, product), `/${locale}/products/${product.slug}`);

  // Signature interaction: the only client-side control on the page, its
  // accessible name in the chosen language only (one identifiable language).
  assert.match(body, /<button[^>]*aria-pressed="(true|false)"/);
  assert.match(
    body,
    new RegExp(
      `<button[^>]*aria-label="${escapeRegExp(copy.lightsToggleLabel[locale])}"`,
    ),
  );

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
      assert.ok(body.includes(APPROVED.referencePending[locale]));
      assert.doesNotMatch(body, /MyConcept/);
      assert.ok(!body.includes("2026-10-12"), "fabricated check date in body");
      // Single-locale: the alt language's pending copy never renders.
      assertAltAbsent(
        body,
        [APPROVED.referencePending[altOf(locale)]],
        `/${locale}/products/ph-1-1-piano-table-limited`,
      );
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

      // Hero copy, exact approved strings in the CHOSEN language: eyebrow,
      // THE single hero lead (the old second lead passage was the ALT-locale
      // "paired lead" — under single-locale display it would duplicate the
      // sentence in the same language, so it is NOT rendered; pinned below)
      // and the drop framing, each with its lang attribute (WCAG 3.1.2).
      assert.ok(body.includes(siteContent("hero.eyebrow", locale)), "missing hero eyebrow");
      assert.ok(body.includes(siteContent("hero.lead", locale)), "missing hero lead");
      assert.ok(
        !body.includes(siteContent("hero.leadPaired", locale)),
        "the paired-lead variant must NOT render (single hero lead)",
      );
      assert.ok(
        body.includes(siteContent("drop.framing", locale)),
        "missing drop framing",
      );
      assert.match(
        body,
        new RegExp(
          `<h1[^>]*lang="${docLang}"[^>]*>\\s*${escapeRegExp(siteContent("hero.lead", locale))}`,
        ),
      );

      // One collection heading in the chosen language (I18N-01).
      assert.ok(body.includes(siteContent("drop.piecesHeading", locale)));

      // Trust strip + footer: disclosure at least twice in the chosen
      // language (trust strip + footer).
      assert.ok(
        count(body, APPROVED.disclosure[locale]) >= 2,
        "disclosure must appear at least twice (trust strip + footer)",
      );
      assert.ok(body.includes(copy.trustStripLabel[locale]));
      assert.ok(body.includes(siteContent("enquiry.intro", locale)));

      // Footer location from site content with the brand.
      assert.ok(body.includes(`${BRAND} · ${siteContent("footer.location", locale)}`));

      // One home link label in the chosen locale (the nav renders the
      // chosen language only).
      assert.ok(
        body.includes(`<span lang="${docLang}">${copy.navHome[locale]}</span>`),
        "home link label must render in the chosen locale",
      );

      // THE KEY REGRESSION (founder 2026-10-14): the ALT locale's approved
      // copy must be ABSENT from the whole homepage.
      assertAltAbsent(body, altHomeCopy(locale), `/${locale}`);

      // Unconfirmed stock everywhere, no numbers (commitment 5b), the
      // chosen locale's placeholder only.
      assert.ok(body.includes(copy.stockUnconfirmed[locale]));
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

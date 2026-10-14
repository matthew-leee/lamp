/*
  Behavioral regression tests for the locale routing contract (review
  finding 5, hardened per re-review). Runs against a production server
  spawned on a random test port; requires a prior `npm run build`
  (documented in web/README.md).

  Contract asserted:
  - /en -> 200, <html lang="en">, English <title>
  - /zh-HK -> 200, <html lang="zh-Hant-HK">, Chinese <title>
  - /fr -> 404, bare shell still declares a document language
  - /en/nope, /zh-HK/nope -> 404 bare shell (no matching route). Document
    language is the documented default 'en'; the 404 content renders that
    one locale's passages, language-marked (WCAG 3.1.2). A locale-scoped
    catch-all was rejected: notFound() thrown at request time escapes SSR in
    this no-root-layout setup and the document recovers with no lang.
  - language of parts: assertions run against the rendered document with all
    <script> blocks stripped, so RSC serialization noise cannot satisfy them.
  - SINGLE-LOCALE DISPLAY (I18N-01 as re-decided by the founder 2026-10-14):
    every passage renders the chosen locale's text only and the ALT locale's
    approved copy is ABSENT; the paired-equal-weight display (both lead
    passages, both collection headings) is retired and these tests pin that
    regression forever. The language switcher is the one control that may
    name both locales (endonyms).
  - aria-current="page" marks the home link only on the actual home route
    (review finding 5, components/current-page-link.tsx).

  Server identity: the port is randomized, readiness is taken from the
  child's own "Ready" output line (not from any server answering), child
  output is captured for diagnostics on failure, and shutdown is awaited.
*/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { siteContent, BRAND } from "./fixtures/seed.mjs";

/* The canonical URL the behavioural build bakes (NEXT_PUBLIC_SITE_URL). */
const SITE_URL = "http://localhost:3000";

/* Copy expectations come from the seed fixture rendered with the test brand
   (D1: company copy lives in the database; the build bakes it). Structural
   assertions (lang attributes, classes, aria) stay locale-based. */

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
const port = 4200 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;

let server;
let serverOut = "";
let serverErr = "";

before(async () => {
  // The spawned server renders regenerations at request time (the 60s
  // fetch leases since T4) and reads the brand/site-URL config dynamically
  // from process.env at RUNTIME — pin it here instead of trusting the
  // ambient shell: a brand-less shell made every regen throw and race 404s
  // whenever a suite ran more than 60s after the build. The API base is
  // statically accessed and so inlined at build; setting it documents the
  // gate's build value. The API + seeded DB must be reachable as for
  // `npm run build`, because regens fetch live.
  const env = { ...process.env };
  env.NEXT_PUBLIC_SITE_URL = SITE_URL;
  env.NEXT_PUBLIC_BRAND_NAME = BRAND;
  env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:18080";
  delete env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  delete env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  delete env.NEXT_PUBLIC_GSC_VERIFICATION;
  server = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: webRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (serverOut += d));
  server.stderr.on("data", (d) => (serverErr += d));

  // Readiness comes from the child's own stdout, so we can never mistake a
  // foreign server on a port collision for ours.
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

/** The class attribute of the element whose text content is exactly `text`. */
function elementClassOf(body, text) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(
    new RegExp(`<([a-z0-9]+)[^>]*class="([^"]*)"[^>]*>${escaped}</`),
  );
  assert.ok(match, `expected an element whose text is exactly "${text}"`);
  return match[2];
}

test("/en serves English document", () =>
  check(async () => {
    const { status, html } = await get("/en");
    assert.equal(status, 200);
    assert.match(html, /<html lang="en"/);
    assert.match(
      html,
      new RegExp(`<title>${escapeRegExp(siteContent("meta.home.title", "en"))}`),
    );
  }));

test("/zh-HK serves Traditional Chinese document", () =>
  check(async () => {
    const { status, html } = await get("/zh-HK");
    assert.equal(status, 200);
    assert.match(html, /<html lang="zh-Hant-HK"/);
    assert.match(
      html,
      new RegExp(`<title>${escapeRegExp(siteContent("meta.home.title", "zh-HK"))}`),
    );
  }));

// Single-locale regression (I18N-01, founder 2026-10-14): the hero lead
// passages render the CHOSEN language only — the old paired-lead typography
// (chosen-language lead + ALT-language lead at equal weight) is retired.
test("/en: hero leads render the chosen language only (I18N-01 single-locale)", () =>
  check(async () => {
    const { html } = await get("/en");
    const body = visible(html);
    assert.match(
      body,
      new RegExp(
        `<h1[^>]*lang="en"[^>]*>\s*${escapeRegExp(siteContent("hero.lead", "en"))}`,
      ),
    );
    // Single hero lead (founder decision 2026-10-14, architect fix): the
    // paired-lead VARIANT must NOT render either — under single-locale
    // display it would duplicate the lead sentence in the SAME language
    // (it stays seeded DATA, admin-editable, just not rendered).
    assert.ok(
      !body.includes(siteContent("hero.leadPaired", "en")),
      "the paired-lead variant must NOT render (single hero lead)",
    );
    // The ALT locale's lead copy is absent (the key regression).
    assert.ok(!body.includes(siteContent("hero.leadPaired", "zh-HK")));
    assert.ok(!body.includes(siteContent("hero.lead", "zh-HK")));
  }));

// Single-locale regression (I18N-01, founder 2026-10-14): ONE collection
// heading in the chosen language. The old pair (two identical-class
// headings, one per language) is retired; the heading keeps the
// script-aware display token so the chosen locale's script gets the right
// family from one class list.
test("collection heading renders once, in the chosen language (I18N-01)", () =>
  check(async () => {
    for (const locale of ["en", "zh-HK"]) {
      const body = visible((await get(`/${locale}`)).html);
      const heading = elementClassOf(
        body,
        siteContent("drop.piecesHeading", locale),
      );
      assert.match(heading, /\btext-2xl\b/);
      assert.match(heading, /\bfont-display-pair\b/);
      const alt = locale === "en" ? "zh-HK" : "en";
      assert.ok(
        !body.includes(siteContent("drop.piecesHeading", alt)),
        `alt-locale collection heading must not render on /${locale}`,
      );
    }
  }));

// Review finding 5: aria-current="page" belongs to the home nav link only
// when the visitor is actually on the home route. The shared header cannot
// know the path server-side (it lives in the [lang] layout), so the decision
// is made client-side via usePathname (components/current-page-link.tsx) and
// baked into the prerendered HTML.
test("aria-current=\"page\" marks the home link only on the home route", () =>
  check(async () => {
    for (const locale of ["en", "zh-HK"]) {
      const home = visible((await get(`/${locale}`)).html);
      const product = visible(
        (await get(`/${locale}/products/panthella-160-v3-beige`)).html,
      );

      assert.equal(
        count(home, 'aria-current="page"'),
        1,
        `exactly one aria-current="page" on /${locale}`,
      );
      const idx = home.indexOf('aria-current="page"');
      const tag = home.slice(home.lastIndexOf("<a", idx), home.indexOf(">", idx));
      assert.ok(
        tag.includes(`href="/${locale}"`),
        `aria-current="page" must sit on the /${locale} home link, found: ${tag}`,
      );
      assert.equal(
        count(product, 'aria-current="page"'),
        0,
        `no aria-current="page" on /${locale}/products/...`,
      );
    }
  }));

// Language-of-parts assertions bind the lang attribute to the passage's own
// text (WCAG 3.1.2): each lead passage is marked with the CHOSEN language.
test("language of parts: /en marks its lead passages as English", () =>
  check(async () => {
    const { html } = await get("/en");
    const body = visible(html);
    assert.match(
      body,
      new RegExp(
        `<h1[^>]*lang="en"[^>]*>\s*${escapeRegExp(siteContent("hero.lead", "en"))}`,
      ),
    );
  }));

test("language of parts: /zh-HK marks its lead passages as Traditional Chinese", () =>
  check(async () => {
    const { html } = await get("/zh-HK");
    const body = visible(html);
    assert.match(
      body,
      new RegExp(
        `<h1[^>]*lang="zh-Hant-HK"[^>]*>\s*${escapeRegExp(siteContent("hero.lead", "zh-HK"))}`,
      ),
    );
  }));

test("language switcher accessible name is localized per locale", () =>
  check(async () => {
    const en = visible((await get("/en")).html);
    const zh = visible((await get("/zh-HK")).html);
    assert.match(en, /<nav[^>]*aria-label="Language"/);
    assert.match(zh, /<nav[^>]*aria-label="語言"/);
  }));

test("unsupported locale /fr is a 404 with a declared document language", () =>
  check(async () => {
    const { status, html } = await get("/fr");
    assert.equal(status, 404);
    assert.match(html, /<html lang="en"/);
  }));

test("unknown subpath /en/nope is a 404 with a declared language", () =>
  check(async () => {
    const { status, html } = await get("/en/nope");
    assert.equal(status, 404);
    assert.match(html, /<html lang="en"/);
  }));

test("unknown subpath /zh-HK/nope: bare shell, default-locale marked content", () =>
  check(async () => {
    const { status, html } = await get("/zh-HK/nope");
    assert.equal(status, 404);
    assert.match(html, /<html lang="en"/);
    const body = visible(html);
    // The 404 heading and body render the documented DEFAULT locale only,
    // language-marked (WCAG 3.1.2); the alt locale's passages never render
    // (single-locale display, founder 2026-10-14).
    assert.match(body, /<h1[^>]*lang="en"[^>]*>[^<]*Page not found/);
    assert.doesNotMatch(body, /lang="zh-Hant-HK"[^>]*>[^<]*找不到頁面/);
    // The DOCUMENT TITLE is single-language too (review finding: the old
    // bilingual "Page not found / 找不到頁面" title showed BOTH languages in
    // the browser tab of an <html lang="en"> document).
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    assert.match(title, /Page not found/);
    assert.ok(
      !title.includes("找不到頁面"),
      `title must be single-language, got: ${title}`,
    );
    // The language switcher (the one control that may name both locales)
    // stays, with its single-language accessible name and declared language.
    assert.match(body, /<nav[^>]*aria-label="Language"[^>]*lang="en"/);
  }));

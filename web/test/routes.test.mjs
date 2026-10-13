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
    language is the documented default 'en'; the bilingual not-found content
    marks each passage (WCAG 3.1.2). A locale-scoped catch-all was rejected:
    notFound() thrown at request time escapes SSR in this no-root-layout
    setup and the document recovers with no lang.
  - language of parts: assertions run against the rendered document with all
    <script> blocks stripped, so RSC serialization noise cannot satisfy them.
  - equal typography (I18N-01, review finding 4): the homepage collection
    heading pair shares an IDENTICAL class list, extending the paired-lead
    typography regression.
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

import { siteContent } from "./fixtures/seed.mjs";

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
  server = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: webRoot,
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

test("/en: paired lead copy shares one type class (I18N-01 equal weight)", () =>
  check(async () => {
    const { html } = await get("/en");
    const body = visible(html);
    const leads =
      body.match(/text-4xl leading-\[1\.35\] text-charcoal sm:text-5xl/g) ?? [];
    assert.ok(
      leads.length >= 2,
      `expected both lead passages to share the lead class, found ${leads.length}`,
    );
  }));

// Equal-typography regression, extended (I18N-01, review finding 4): the
// homepage collection heading pair must share an IDENTICAL class list, so
// neither language can become the smaller, greyer translation. The pair
// deliberately uses one script-aware font class (globals.css
// font-display-pair: Fraunces for Latin, Noto Serif TC for Han) precisely so
// the two class lists can be byte-identical.
test("collection heading pair shares an identical class list (I18N-01)", () =>
  check(async () => {
    for (const locale of ["en", "zh-HK"]) {
      const body = visible((await get(`/${locale}`)).html);
      const first = elementClassOf(body, siteContent("drop.piecesHeading", locale));
      const second = elementClassOf(
        body,
        siteContent("drop.piecesHeading", locale === "en" ? "zh-HK" : "en"),
      );
      assert.equal(
        first,
        second,
        `collection headings on /${locale} must have identical class lists`,
      );
      assert.match(first, /\btext-2xl\b/);
      assert.match(first, /\bfont-display-pair\b/);
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

// Lead language assertions bind the language attribute to the lead's own
// text, so the footer's smaller paired paragraphs cannot satisfy them.
test("language of parts: /en marks its Chinese lead passage", () =>
  check(async () => {
    const { html } = await get("/en");
    const body = visible(html);
    assert.match(
      body,
      new RegExp(
        `<p[^>]*lang="zh-Hant-HK"[^>]*>\s*${escapeRegExp(siteContent("hero.leadPaired", "zh-HK"))}`,
      ),
    );
  }));

test("language of parts: /zh-HK marks its English lead passage", () =>
  check(async () => {
    const { html } = await get("/zh-HK");
    const body = visible(html);
    assert.match(
      body,
      new RegExp(
        `<p[^>]*lang="en"[^>]*>\s*${escapeRegExp(siteContent("hero.leadPaired", "en"))}`,
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

test("unknown subpath /zh-HK/nope: bare shell, bilingual marked content", () =>
  check(async () => {
    const { status, html } = await get("/zh-HK/nope");
    assert.equal(status, 404);
    assert.match(html, /<html lang="en"/);
    const body = visible(html);
    // Both not-found passages are rendered and language-marked.
    assert.match(body, /<span[^>]*lang="en"[^>]*>[^<]*Page not found/);
    assert.match(body, /<span[^>]*lang="zh-Hant-HK"[^>]*>[^<]*找不到頁面/);
    // Single-language accessible name with its own declared language.
    assert.match(body, /<nav[^>]*aria-label="Language"[^>]*lang="en"/);
  }));

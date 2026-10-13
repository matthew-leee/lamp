/*
  Behavioral tests for the T4 SEO surface against a production server
  spawned on a random test port: JSON-LD, canonical/hreflang, sitemap,
  robots, GA/GSC off-by-default, and the bare-404 stylesheet (Q3).
  Requires a prior `npm run build` (documented in web/README.md).

  The child env has the analytics vars removed, so the default build asserts
  the OFF paths (GA-OFF-01): no googletagmanager script, no GSC meta tag.
*/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BRAND, CATALOGUE } from "./fixtures/seed.mjs";

/* The canonical URL the behavioural build bakes (NEXT_PUBLIC_SITE_URL). */
const SITE_URL = "http://localhost:3000";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
const port = 7200 + Math.floor(Math.random() * 600);
const base = `http://127.0.0.1:${port}`;

let server;
let serverOut = "";
let serverErr = "";

before(async () => {
  const env = { ...process.env };
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
    `test server (pid ${server.pid}) did not exit. stdout:\n${serverOut}\nstderr:\n${serverErr}`,
  );
});

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
  return { status: res.status, text: await res.text() };
}

/* ---------------------------------------------------------------- */

for (const locale of ["en", "zh-HK"]) {
  test(`/products pages (${locale}): canonical + hreflang + x-default`, () =>
    check(async () => {
      const slug = "panthella-160-v3-beige";
      const { status, text } = await get(`/${locale}/products/${slug}`);
      assert.equal(status, 200);
      assert.match(
        text,
        new RegExp(
          `<link[^>]*rel="canonical"[^>]*href="${SITE_URL}/${locale}/products/${slug}"`,
        ),
      );
      for (const [tag, url] of [
        ["en", `${SITE_URL}/en/products/${slug}`],
        ["zh-Hant-HK", `${SITE_URL}/zh-HK/products/${slug}`],
        ["x-default", `${SITE_URL}/en/products/${slug}`],
      ]) {
        assert.match(
          text,
          new RegExp(
            `<link[^>]*rel="alternate"[^>]*hreflang="${tag}"[^>]*href="${url}"`,
            "i",
          ),
          `missing hreflang=${tag}`,
        );
      }
    }));

  test(`home (${locale}): canonical + hreflang`, () =>
    check(async () => {
      const { status, text } = await get(`/${locale}`);
      assert.equal(status, 200);
      assert.match(
        text,
        new RegExp(`<link[^>]*rel="canonical"[^>]*href="${SITE_URL}/${locale}"`),
      );
      assert.match(text, /hreflang="zh-Hant-HK"/i);
      assert.match(text, /hreflang="x-default"/i);
    }));

  test(`/products pages (${locale}): Product JSON-LD, price + currency, NO availability`, () =>
    check(async () => {
      const product = CATALOGUE.find((p) => p.slug === "ph-2-1-table-chrome");
      const { text } = await get(`/${locale}/products/${product.slug}`);
      const match = text.match(
        /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
      );
      assert.ok(match, "missing JSON-LD script");
      const ld = JSON.parse(match[1]);
      assert.equal(ld["@type"], "Product");
      assert.equal(ld.sku, product.slug);
      assert.equal(ld.brand.name, "Louis Poulsen");
      assert.equal(ld.offers.priceCurrency, "HKD");
      // Price in the JSON-LD equals the catalogue price (integer-math string).
      const whole = Math.floor(product.priceCents / 100);
      const minor = product.priceCents % 100;
      assert.equal(
        ld.offers.price,
        `${whole}.${String(minor).padStart(2, "0")}`,
      );
      assert.equal(
        ld.offers.url,
        `${SITE_URL}/${locale}/products/${product.slug}`,
      );
      // Never an availability claim: stock is live fail-closed data, and
      // JSON-LD is baked at build (commitment 5b).
      assert.equal("availability" in ld.offers, false);
    }));
}

test("GA and GSC are OFF by default (no id configured): no scripts, no meta", () =>
  check(async () => {
    const { text } = await get("/en");
    assert.doesNotMatch(text, /googletagmanager\.com/);
    assert.doesNotMatch(text, /dataLayer/);
    assert.doesNotMatch(text, /gtag\(/);
    assert.doesNotMatch(text, /google-site-verification/);
  }));

test("/sitemap.xml: both locales x (home + 8 products) = 18 absolute URLs", () =>
  check(async () => {
    const { status, text } = await get("/sitemap.xml");
    assert.equal(status, 200);
    const urls = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(urls.length, 18, `expected 18 sitemap URLs, got ${urls.length}`);
    for (const url of urls) {
      assert.ok(url.startsWith(`${SITE_URL}/`), `not absolute: ${url}`);
    }
    for (const locale of ["en", "zh-HK"]) {
      assert.ok(
        urls.includes(`${SITE_URL}/${locale}`),
        `missing ${locale} home`,
      );
      for (const product of CATALOGUE) {
        assert.ok(
          urls.includes(`${SITE_URL}/${locale}/products/${product.slug}`),
          `missing ${locale} ${product.slug}`,
        );
      }
    }
  }));

test("/robots.txt: allow all, disallow /api/, absolute sitemap URL", () =>
  check(async () => {
    const { status, text } = await get("/robots.txt");
    assert.equal(status, 200);
    // Next renders the directives capitalized (User-Agent / Allow);
    // line-anchored so "Allow" cannot be satisfied by "Disallow".
    assert.match(text, /^user-agent: \*$/mi);
    assert.match(text, /^allow: \/$/mi);
    assert.match(text, /^disallow: \/api\/$/mi);
    assert.match(text, new RegExp(`^Sitemap: ${SITE_URL}/sitemap.xml$`, "m"));
  }));

test("bare 404 shell loads the token stylesheet (Q3: single source, no inline hex)", () =>
  check(async () => {
    const { status, text } = await get("/nope-not-a-route");
    assert.equal(status, 404);
    // The stylesheet <link> reaches the routeless document (Q3 experiment
    // pinned): the 404 styles from globals.css tokens, not inline hex.
    assert.match(text, /<link[^>]*rel="stylesheet"[^>]*href="[^"]*\/_next\/static\/css\/[^"]+\.css"/);
    // ...and no hex color literals inline anywhere in the 404 document.
    assert.doesNotMatch(text, /#[0-9a-fA-F]{6}\b/);
    // Bilingual content still rendered with language-of-parts.
    assert.match(text, /lang="en"[^>]*>[^<]*Page not found/);
    assert.match(text, /lang="zh-Hant-HK"[^>]*>[^<]*找不到頁面/);
  }));

test(`the brand renders only as configuration (${BRAND} from build env)`, () =>
  check(async () => {
    // Sanity for NAME-01 at the route level: the wordmark renders the
    // resolved brand, never a code literal.
    const { text } = await get("/en");
    assert.ok(text.includes(BRAND));
  }));
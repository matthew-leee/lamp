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

  Server identity: the port is randomized, readiness is taken from the
  child's own "Ready" output line (not from any server answering), child
  output is captured for diagnostics on failure, and shutdown is awaited.
*/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/** Rendered HTML with every <script> block removed. */
function visible(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, "");
}

test("/en serves English document", () =>
  check(async () => {
    const { status, html } = await get("/en");
    assert.equal(status, 200);
    assert.match(html, /<html lang="en"/);
    assert.match(html, /<title>HAVN \| Curated designer homeware/);
  }));

test("/zh-HK serves Traditional Chinese document", () =>
  check(async () => {
    const { status, html } = await get("/zh-HK");
    assert.equal(status, 200);
    assert.match(html, /<html lang="zh-Hant-HK"/);
    assert.match(html, /<title>HAVN \| 精選設計家居/);
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

// Lead language assertions bind the language attribute to the lead's own
// text, so the footer's smaller paired paragraphs cannot satisfy them.
test("language of parts: /en marks its Chinese lead passage", () =>
  check(async () => {
    const { html } = await get("/en");
    const body = visible(html);
    assert.match(body, /<p[^>]*lang="zh-Hant-HK"[^>]*>\s*HAVN 精選設計家居/);
  }));

test("language of parts: /zh-HK marks its English lead passage", () =>
  check(async () => {
    const { html } = await get("/zh-HK");
    const body = visible(html);
    assert.match(
      body,
      /<p[^>]*lang="en"[^>]*>\s*HAVN, curated designer homeware/,
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

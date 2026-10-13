/*
  Behavioral tests for the D2b admin login/relay surface (ADMIN-01) against
  a production server spawned on a random test port. Requires a prior
  `npm run build` AND a reachable Rust API + seeded DB (documented below,
  same gate as the build): the login relay calls the live API.

  PRECONDITIONS (fail-loud, SKIP-FREE — this suite never silently skips):
  1. `npm run build` has run from this checkout with the API + seeded DB up,
     so the build CONTAINS the admin routes. A stale build is detected
     below and fails with an explicit message.
  2. The Rust admin API is reachable at NEXT_PUBLIC_API_URL (default
     http://127.0.0.1:18080, the gate's build value) with the seeded DB and
     the gate's bootstrap admin: env overrides ADMIN_TEST_USERNAME (default
     "admin-test") / ADMIN_TEST_PASSWORD (default
     "test-admin-password-fake-0001") — the api gate recipe values,
     obviously fake, never real credentials. The probe signs in once with
     them before any test runs.

  Contract asserted (browser -> web relay -> Rust login -> cookie re-set ->
  server components forward; never browser -> API):
  - GET /admin/login -> 200 with the labeled username/password inputs and
    the form action pointing at the web relay
  - GET /admin/login?error=invalid -> the exact safe slug message
  - GET /admin without a cookie -> redirect to /admin/login
  - POST wrong creds -> 303 to /admin/login?error=invalid with NO session
    cookie set
  - POST right creds -> 303 to /admin and Set-Cookie admin_session=...
    HttpOnly + SameSite=Lax (re-set on the WEB response)
  - GET /admin with that cookie -> 200, "signed in as <user>" (session
    forwarding: the server component confirmed the cookie via whoami)
  - GET /admin with a garbage cookie -> redirect to /admin/login
  - POST /admin/api/logout with the cookie -> 303 + the cookie cleared
  Assertions are statuses/locations/cookie presence only — token internals
  are deliberately NOT asserted.

  Server identity: the port is randomized, readiness is taken from the
  child's own "Ready" output line, child output is captured for
  diagnostics on failure, and shutdown is awaited (skeleton mirrored from
  test/routes.test.mjs).
*/

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BRAND } from "./fixtures/seed.mjs";

/* The canonical URL the behavioural build bakes (NEXT_PUBLIC_SITE_URL). */
const SITE_URL = "http://localhost:3000";

/* The API base is statically accessed and so inlined at build: the value
   pinned to the child must match the gate's build value (default below). */
const API_URL = process.env.NEXT_PUBLIC_API_URL?.trim() || "http://127.0.0.1:18080";

/* Gate bootstrap credentials (api gate recipe, obviously fake). */
const ADMIN_TEST_USERNAME = process.env.ADMIN_TEST_USERNAME || "admin-test";
const ADMIN_TEST_PASSWORD =
  process.env.ADMIN_TEST_PASSWORD || "test-admin-password-fake-0001";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
const port = 8200 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;

let server;
let serverOut = "";
let serverErr = "";

/** The session cookie from the successful-login case (cookie presence only). */
let sessionCookie;

before(async () => {
  // Precondition 2: the Rust admin API + seeded DB + bootstrap admin must
  // work BEFORE anything spawns — fail loud with the recipe, never skip.
  let probe;
  try {
    probe = await fetch(`${API_URL}/api/admin/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        username: ADMIN_TEST_USERNAME,
        password: ADMIN_TEST_PASSWORD,
      }),
    });
  } catch (err) {
    throw new Error(
      `admin-routes precondition failed: the Rust admin API is unreachable at ` +
        `${API_URL} (${String(err)}). Start it with the seeded DB as for ` +
        `\`npm run build\` (cd api && cargo run), bootstrapped with the gate's ` +
        `ADMIN_USERNAME/ADMIN_PASSWORD = ${ADMIN_TEST_USERNAME} / ` +
        `<ADMIN_TEST_PASSWORD env override> and re-run. This suite never skips.`,
    );
  }
  if (probe.status !== 200) {
    throw new Error(
      `admin-routes precondition failed: ${API_URL}/api/admin/login answered ` +
        `HTTP ${probe.status} for the gate bootstrap creds ` +
        `(${ADMIN_TEST_USERNAME} / <ADMIN_TEST_PASSWORD env override>; the ` +
        `api gate recipe values, obviously fake). Check the seeded DB and that ` +
        `ADMIN_USERNAME/ADMIN_PASSWORD were set at API boot. This suite never skips.`,
    );
  }

  // The spawned server renders regenerations at request time and reads the
  // brand/site-URL config at RUNTIME — pin it exactly like the committed
  // behavioural suites. The API base is inlined at build; setting it
  // documents the gate's build value.
  const env = { ...process.env };
  env.NEXT_PUBLIC_SITE_URL = SITE_URL;
  env.NEXT_PUBLIC_BRAND_NAME = BRAND;
  env.NEXT_PUBLIC_API_URL = API_URL;
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

  // Precondition 1: the build must contain the D2b admin routes.
  const loginPage = await fetch(`${base}/admin/login`);
  if (loginPage.status !== 200) {
    throw new Error(
      `admin-routes precondition failed: GET /admin/login answered HTTP ` +
        `${loginPage.status} — the .next build predates the D2b admin routes ` +
        `(or npm run build has not run since this checkout). Build with the API ` +
        `+ seeded DB up (cd web && npm run build) and re-run. This suite never skips.`,
    );
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

/** GET without following redirects; returns status/location/html. */
async function get(pathname, { cookie } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    redirect: "manual",
    headers: cookie === undefined ? {} : { cookie },
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    html: await res.text(),
  };
}

/** Rendered HTML with <script> blocks and React comment separators removed. */
function visible(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!--.*?-->/g, "");
}

/** POST the plain form to the login relay without following redirects. */
async function postLogin(username, password, { origin } = {}) {
  const res = await fetch(`${base}/admin/api/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(origin === undefined ? {} : { origin }),
    },
    body: new URLSearchParams({ username, password }).toString(),
  });
  return {
    status: res.status,
    location: res.headers.get("location"),
    setCookie: res.headers.getSetCookie(),
  };
}

/**
 * RELATIVE Location pin (review finding 1): the relay must answer with a
 * host-stable relative target — an absolute Location derived from the
 * request URL would bounce 127.0.0.1 visitors to localhost (and leak the
 * internal origin behind a reverse proxy).
 */
function assertRelativeLocation(location, pathname, search) {
  assert.ok(location, "redirect must carry a Location header");
  assert.ok(
    new RegExp(`^${pathname}${search ?? ""}$`).test(location) && !/^https?:/i.test(location),
    `Location must be RELATIVE (${pathname}${search ?? ""}), got: ${location}`,
  );
}

/** Resolve a Location header (absolute or relative) against the base. */
function redirectPath(location) {
  assert.ok(location, "redirect must carry a Location header");
  return new URL(location, base);
}

/** Assert some <input> tag carries ALL of attrs (attribute-order agnostic). */
function assertInputHas(html, attrs) {
  const inputs = html.match(/<input[^>]*>/g) ?? [];
  const wanted = attrs.map(([k, v]) => `${k}="${v}"`).join(" ");
  // Case-insensitive attribute names: React 19 SSR preserves camelCase in
  // the rendered HTML (autoComplete=..., same quirk as hrefLang) — the
  // existing suites match case-insensitively for the same reason.
  const found = inputs.some((tag) =>
    attrs.every(([k, v]) => tag.includes(`${k}="${v}"`) ||
      new RegExp(`${k}="${v}"`, "i").test(tag)),
  );
  assert.ok(
    found,
    `expected an <input ${wanted}>, got: ${inputs.join(" | ")}`,
  );
}

/** Assert a redirect emitted by Next's redirect() in a server component. */
function assertPageRedirect(res, pathname) {
  // redirect() owns its status (307 for page navigation today); assert the
  // redirect family + exact Location instead of pinning Next's choice.
  assert.ok(
    [303, 307, 308].includes(res.status),
    `expected a redirect, got ${res.status}`,
  );
  const url = redirectPath(res.location);
  assert.equal(url.pathname, pathname);
}

test("GET /admin/login serves the sign-in form (labeled inputs + relay action)", () =>
  check(async () => {
    const { status, html } = await get("/admin/login");
    assert.equal(status, 200);
    assert.match(html, /<form[^>]*method="post"/);
    assert.match(html, /<form[^>]*action="\/admin\/api\/login"/);
    assert.match(html, /<label[^>]*for="username"/);
    assert.match(html, /<label[^>]*for="password"/);
    assertInputHas(html, [
      ["name", "username"],
      ["autocomplete", "username"],
    ]);
    assertInputHas(html, [
      ["name", "password"],
      ["type", "password"],
      ["autocomplete", "current-password"],
    ]);
  }));

test("GET /admin/login?error=invalid shows the exact safe message", () =>
  check(async () => {
    const { status, html } = await get("/admin/login?error=invalid");
    assert.equal(status, 200);
    assert.match(html, /role="alert"/);
    assert.match(visible(html), /Invalid username or password\./);
  }));

test("GET /admin without a cookie redirects to /admin/login", () =>
  check(async () => {
    const res = await get("/admin");
    assertPageRedirect(res, "/admin/login");
  }));

test("POST blank form -> 303 /admin/login?error=form (form error, no API call)", () =>
  check(async () => {
    const { status, location, setCookie } = await postLogin("", "");
    assert.equal(status, 303);
    assertRelativeLocation(location, "/admin/login", "\\?error=form");
    assert.equal(
      setCookie.some((line) => line.startsWith("admin_session=")),
      false,
      "a blank form must not set admin_session",
    );
  }));

test("GET /admin/login?error=__proto__ renders NO message (untrusted slugs cannot index a prototype)", () =>
  check(async () => {
    const { status, html } = await get("/admin/login?error=__proto__");
    assert.equal(status, 200);
    assert.doesNotMatch(html, /role="alert"/);
    for (const slug of ["constructor", "toString", "hasOwnProperty"]) {
      const res = await get(`/admin/login?error=${slug}`);
      assert.equal(res.status, 200);
      assert.doesNotMatch(res.html, /role="alert"/);
    }
  }));

test("POST login with a CROSS-ORIGIN Origin header -> 403 (login-CSRF leg)", () =>
  check(async () => {
    const res = await postLogin(ADMIN_TEST_USERNAME, ADMIN_TEST_PASSWORD, {
      origin: "http://evil.example",
    });
    assert.equal(res.status, 403);
    assert.equal(res.location, null);
    assert.equal(
      res.setCookie.some((line) => line.startsWith("admin_session=")),
      false,
      "a cross-origin login must never mint a session",
    );
  }));

test("POST login with a MATCHING same-origin Origin header passes the guard", () =>
  check(async () => {
    const res = await postLogin(ADMIN_TEST_USERNAME, ADMIN_TEST_PASSWORD, {
      origin: base,
    });
    assert.equal(res.status, 303);
    assertRelativeLocation(res.location, "/admin");
    assert.ok(
      res.setCookie.some((line) => line.startsWith("admin_session=")),
      "a same-origin login mints the session normally",
    );
  }));

test("POST wrong creds -> 303 /admin/login?error=invalid, no session cookie", () =>
  check(async () => {
    const { status, location, setCookie } = await postLogin(
      "definitely-wrong",
      "definitely-wrong",
    );
    assert.equal(status, 303);
    assertRelativeLocation(location, "/admin/login", "\\?error=invalid");
    assert.equal(
      setCookie.some((line) => line.startsWith("admin_session=")),
      false,
      "a failed login must not set admin_session",
    );
  }));

test("POST right creds -> 303 /admin + relayed session semantics (Path/HttpOnly/Lax/Max-Age, no Secure locally)", () =>
  check(async () => {
    const { status, location, setCookie } = await postLogin(
      ADMIN_TEST_USERNAME,
      ADMIN_TEST_PASSWORD,
    );
    assert.equal(status, 303);
    assertRelativeLocation(location, "/admin");
    const session = setCookie.find((line) => line.startsWith("admin_session="));
    assert.ok(session, "the relayed Set-Cookie must set admin_session");
    // REDACTED copy for diagnostics (review finding): assert.match failure
    // output includes the actual string — the bearer token must never be
    // printable by a failing assertion.
    const redacted = session.replace(/(admin_session=)[^;]+/i, "$1<redacted>");
    assert.match(redacted, /Path=\//i);
    assert.match(redacted, /HttpOnly/i);
    assert.match(redacted, /SameSite=Lax/i);
    assert.match(redacted, /Max-Age=\d+/i);
    // The gate API runs SESSION_COOKIE_SECURE=false: no Secure attribute
    // may be INVENTED by the relay (it relays the API's attributes).
    assert.doesNotMatch(redacted, /Secure/i);
    // Cookie presence only: the token value is never inspected or printed.
    sessionCookie = session.split(";")[0];
  }));

test("GET /admin with the session cookie -> 200, signed in as the user", () =>
  check(async () => {
    assert.ok(
      sessionCookie,
      "the successful-login case must have stored a session cookie",
    );
    const { status, html } = await get("/admin", { cookie: sessionCookie });
    assert.equal(status, 200);
    assert.ok(
      visible(html).includes(`signed in as ${ADMIN_TEST_USERNAME}`),
      "the shell must name the session user (whoami forwarding)",
    );
  }));

test("GET /admin with a garbage cookie redirects to /admin/login", () =>
  check(async () => {
    const res = await get("/admin", { cookie: "admin_session=garbage" });
    assertPageRedirect(res, "/admin/login");
  }));

test("POST /admin/api/logout -> 303, session cookie deleted (Max-Age=0)", () =>
  check(async () => {
    assert.ok(
      sessionCookie,
      "the successful-login case must have stored a session cookie",
    );
    const res = await fetch(`${base}/admin/api/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: sessionCookie },
    });
    assert.equal(res.status, 303);
    assertRelativeLocation(res.headers.get("location"), "/admin/login");
    const cleared = res.headers
      .getSetCookie()
      .find((line) => line.startsWith("admin_session="));
    assert.ok(cleared, "logout must re-set admin_session");
    // Deletion semantics (review finding): an empty value WITHOUT expiry
    // is a session cookie that survives the browser restart — require the
    // explicit Max-Age=0, asserted on a redacted copy only.
    const redacted = cleared.replace(/(admin_session=)[^;]*/i, "$1<cleared>");
    assert.match(
      redacted,
      /Max-Age=0(?=;|$)/i,
      "logout must expire the cookie (Max-Age=0 exactly), not just blank it",
    );
    assert.match(redacted, /Path=\//i);
  }));

test("POST /admin/api/logout with a CROSS-ORIGIN Origin header -> 403 (logout-CSRF closed)", () =>
  check(async () => {
    assert.ok(
      sessionCookie,
      "the successful-login case must have stored a session cookie",
    );
    const res = await fetch(`${base}/admin/api/logout`, {
      method: "POST",
      redirect: "manual",
      headers: { cookie: sessionCookie, origin: "http://evil.example" },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("location"), null);
    const cleared = res.headers.getSetCookie();
    assert.equal(
      cleared.some((line) => line.startsWith("admin_session=")),
      false,
      "a cross-origin logout must not touch the session cookie",
    );
  }));

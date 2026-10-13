/*
  Pure unit tests for the Rust admin API client (lib/admin-client.ts).
  No server and no network: fetch is INJECTED per scenario (the client's
  fetchImpl parameter), recording url/method/headers/body for assertions.
  Env knobs are saved and restored per test (house style).

  Contract asserted (D2b ADMIN-01):
  - login POSTs JSON credentials to /api/admin/login with the
    X-Requested-With CSRF header and a JSON content-type
  - a realistic Set-Cookie line parses into name/value + verbatim attribute
    tokens (plain and Secure variants), and serializeSetCookie round-trips
    name/value + ALL attributes
  - status mappings are the exact contract strings: 401/429 fixed literals
    (which are the API's exact bodies), 400/503 the API's own error text
  - network rejection and the AbortController timeout (lib/config.ts
    fetchTimeoutMs) fail closed with "admin API unreachable; retry later"
  - a 200 login WITHOUT a Set-Cookie fails closed ("login succeeded but no
    session cookie") — the relay must never reach the console uncookied
  - whoami forwards Cookie: admin_session=<value> and maps 200/401/other
  - adminGet sends Cookie; adminMutate sends Cookie + XRW + JSON body;
    both never throw (network failure -> status 0)
*/

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_COOKIE_NAME,
  API_UNREACHABLE,
  NO_SESSION_COOKIE,
  adminGet,
  adminLogin,
  adminMutate,
  adminWhoami,
  loginErrorSlug,
  parseSetCookieLine,
  serializeSetCookie,
} from "../lib/admin-client.ts";

const originalTimeout = process.env.NEXT_PUBLIC_FETCH_TIMEOUT_MS;

beforeEach(() => {
  process.env.NEXT_PUBLIC_FETCH_TIMEOUT_MS = "5000";
});

afterEach(() => {
  if (originalTimeout === undefined) {
    delete process.env.NEXT_PUBLIC_FETCH_TIMEOUT_MS;
  } else {
    process.env.NEXT_PUBLIC_FETCH_TIMEOUT_MS = originalTimeout;
  }
});

/** Mock fetch recording url/method/headers/body/signal; restored by caller. */
function mockFetch(impl) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body ?? null,
      signal: init.signal ?? null,
    });
    return impl(url, init);
  };
  return { calls, fetchImpl };
}

/** Response stand-in with JSON body and optional Set-Cookie lines. */
function jsonResponse({ status = 200, json, setCookie } = {}) {
  const lines = setCookie ?? [];
  return {
    status,
    json: async () => json,
    headers: {
      getSetCookie: () => lines,
      get: (name) =>
        name.toLowerCase() === "set-cookie" ? (lines[0] ?? null) : null,
    },
  };
}

const FULL_COOKIE = "admin_session=TOKEN123; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800";
const SECURE_COOKIE = `${FULL_COOKIE}; Secure`;

test("login success: POSTs JSON creds with XRW + content-type to /api/admin/login", async () => {
  const { calls, fetchImpl } = mockFetch(async () =>
    jsonResponse({ json: { ok: true }, setCookie: [FULL_COOKIE] }),
  );

  const result = await adminLogin(
    "https://api.test/",
    "admin-test",
    "pw",
    fetchImpl,
  );

  assert.deepEqual(result.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/api/admin/login"));
  assert.ok(calls[0].url.startsWith("https://api.test/"));
  assert.equal(calls[0].method, "POST");
  assert.equal(typeof calls[0].headers["X-Requested-With"], "string");
  assert.notEqual(calls[0].headers["X-Requested-With"].trim(), "");
  assert.equal(calls[0].headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].body), {
    username: "admin-test",
    password: "pw",
  });
  assert.ok(calls[0].signal, "the shared AbortController signal is wired");
});

test("login parses a realistic Set-Cookie line: value + verbatim attributes", async () => {
  const { fetchImpl } = mockFetch(async () =>
    jsonResponse({ json: { ok: true }, setCookie: [FULL_COOKIE] }),
  );

  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);

  assert.equal(result.ok, true);
  assert.equal(result.cookie.name, ADMIN_COOKIE_NAME);
  assert.equal(result.cookie.value, "TOKEN123");
  assert.deepEqual(result.cookie.attributes, [
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=604800",
  ]);
});

test("login parses the Secure variant (Secure kept as its own token)", async () => {
  const { fetchImpl } = mockFetch(async () =>
    jsonResponse({ json: { ok: true }, setCookie: [SECURE_COOKIE] }),
  );

  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);

  assert.equal(result.ok, true);
  assert.equal(result.cookie.value, "TOKEN123");
  assert.ok(result.cookie.attributes.includes("Secure"));
});

test("login reads set-cookie via headers.get when getSetCookie is absent", async () => {
  const { fetchImpl } = mockFetch(async () => ({
    status: 200,
    json: async () => ({ ok: true }),
    headers: { get: (name) => (name.toLowerCase() === "set-cookie" ? FULL_COOKIE : null) },
  }));

  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);

  assert.equal(result.ok, true);
  assert.equal(result.cookie.value, "TOKEN123");
});

test("serializeSetCookie round-trips name/value + all attributes", () => {
  for (const line of [FULL_COOKIE, SECURE_COOKIE]) {
    const parsed = parseSetCookieLine(line);
    assert.ok(parsed);
    assert.equal(serializeSetCookie(parsed), line);
    // parse . serialize is a fixed point too.
    assert.deepEqual(parseSetCookieLine(serializeSetCookie(parsed)), parsed);
  }
});

test("parseSetCookieLine rejects blank/malformed lines", () => {
  assert.equal(parseSetCookieLine(""), null);
  assert.equal(parseSetCookieLine("   "), null);
  assert.equal(parseSetCookieLine("noname"), null);
  assert.equal(parseSetCookieLine("=novalue"), null);
});

test("login 401 -> invalid username or password", async () => {
  const { fetchImpl } = mockFetch(async () =>
    jsonResponse({ status: 401, json: { error: "invalid username or password" } }),
  );
  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
  assert.deepEqual(result, { ok: false, error: "invalid username or password" });
});

test("login 429 -> too many concurrent login attempts; retry shortly", async () => {
  const { fetchImpl } = mockFetch(async () =>
    jsonResponse({
      status: 429,
      json: { error: "too many concurrent login attempts; retry shortly" },
    }),
  );
  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
  assert.deepEqual(result, {
    ok: false,
    error: "too many concurrent login attempts; retry shortly",
  });
});

test("login 503 -> the API's own error string", async () => {
  const { fetchImpl } = mockFetch(async () =>
    jsonResponse({
      status: 503,
      json: { error: "admin sessions not configured: set SESSION_SECRET (>= 32 bytes)" },
    }),
  );
  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
  assert.deepEqual(result, {
    ok: false,
    error: "admin sessions not configured: set SESSION_SECRET (>= 32 bytes)",
  });
});

test("login 400 -> the API's own error string", async () => {
  const { fetchImpl } = mockFetch(async () =>
    jsonResponse({ status: 400, json: { error: "username and password required" } }),
  );
  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
  assert.deepEqual(result, { ok: false, error: "username and password required" });
});

test("login network rejection -> admin API unreachable; retry later", async () => {
  const { fetchImpl } = mockFetch(async () => {
    throw new TypeError("fetch failed");
  });
  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
  assert.deepEqual(result, { ok: false, error: "admin API unreachable; retry later" });
});

test("login 200 with NO Set-Cookie -> fail-closed error", async () => {
  const { fetchImpl } = mockFetch(async () => jsonResponse({ json: { ok: true } }));
  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
  assert.deepEqual(result, {
    ok: false,
    error: "login succeeded but no session cookie",
  });
});

test("login aborts a hanging API at fetchTimeoutMs and fails closed", async () => {
  process.env.NEXT_PUBLIC_FETCH_TIMEOUT_MS = "100";
  // A never-settling fetch that rejects on abort, exactly like real fetch.
  const { calls, fetchImpl } = mockFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new TypeError("aborted")),
        );
      }),
  );

  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);

  assert.deepEqual(result, { ok: false, error: "admin API unreachable; retry later" });
  assert.equal(calls.length, 1);
});

test("whoami 200 -> username, with Cookie: admin_session=<value>", async () => {
  const { calls, fetchImpl } = mockFetch(async () =>
    jsonResponse({ json: { username: "admin-test" } }),
  );

  const result = await adminWhoami("https://api.test", "TOKEN123", fetchImpl);

  assert.deepEqual(result, { ok: true, username: "admin-test" });
  assert.equal(calls[0].url.endsWith("/api/admin/whoami"), true);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.cookie, "admin_session=TOKEN123");
});

test("whoami 401 -> not authenticated", async () => {
  const { fetchImpl } = mockFetch(async () =>
    jsonResponse({ status: 401, json: { error: "not authenticated" } }),
  );
  const result = await adminWhoami("https://api.test", "stale", fetchImpl);
  assert.deepEqual(result, { ok: false, error: "not authenticated" });
});

test("whoami other statuses/network -> unhealthy, sign in again", async () => {
  for (const impl of [
    async () => jsonResponse({ status: 503, json: { error: "database unavailable" } }),
    async () => {
      throw new TypeError("fetch failed");
    },
  ]) {
    const { fetchImpl } = mockFetch(impl);
    const result = await adminWhoami("https://api.test", "TOKEN123", fetchImpl);
    assert.deepEqual(result, {
      ok: false,
      error: "admin API unreachable or unhealthy; sign in again",
    });
  }
});

test("adminGet sends Cookie and returns {status, json} without throwing", async () => {
  const { calls, fetchImpl } = mockFetch(async () =>
    jsonResponse({ json: { products: [] } }),
  );

  const result = await adminGet(
    "https://api.test",
    "/api/admin/products",
    "TOKEN123",
    fetchImpl,
  );

  assert.deepEqual(result, { status: 200, json: { products: [] } });
  assert.equal(calls[0].url, "https://api.test/api/admin/products");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.cookie, "admin_session=TOKEN123");
});

test("adminGet network failure -> status 0, never throws", async () => {
  const { fetchImpl } = mockFetch(async () => {
    throw new TypeError("fetch failed");
  });
  const result = await adminGet("https://api.test", "/api/admin/products", "v", fetchImpl);
  assert.deepEqual(result, { status: 0, json: null });
});

test("adminMutate sends Cookie + XRW + JSON body", async () => {
  const { calls, fetchImpl } = mockFetch(async () =>
    jsonResponse({ status: 200, json: { ok: true } }),
  );

  const result = await adminMutate(
    "https://api.test",
    "/api/admin/site-content",
    "PUT",
    "TOKEN123",
    { key: "hero.lead", locale: "en", value: "x" },
    fetchImpl,
  );

  assert.deepEqual(result, { status: 200, json: { ok: true } });
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].headers.cookie, "admin_session=TOKEN123");
  assert.equal(calls[0].headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(calls[0].headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].body), {
    key: "hero.lead",
    locale: "en",
    value: "x",
  });
});

test("adminMutate network failure -> status 0, never throws", async () => {
  const { fetchImpl } = mockFetch(async () => {
    throw new TypeError("fetch failed");
  });
  const result = await adminMutate(
    "https://api.test",
    "/api/admin/site-content",
    "PUT",
    "v",
    {},
    fetchImpl,
  );
  assert.deepEqual(result, { status: 0, json: null });
});

/* ------------------------------------------------------------------ */
/* Review-hardening: name-validated session pick, slug mapping, and    */
/* the abort budget covering the BODY, not just the header exchange.  */
/* ------------------------------------------------------------------ */

test("login 200 with a DIFFERENT cookie name -> fail-closed (never mint a session)", async () => {
  const { fetchImpl } = mockFetch(() =>
    jsonResponse({ json: { ok: true }, setCookie: ["csrf_state=other"] }),
  );
  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
  assert.deepEqual(result, { ok: false, error: NO_SESSION_COOKIE });
});

test("login 200 with an EMPTY admin_session value -> fail-closed", async () => {
  const { fetchImpl } = mockFetch(() =>
    jsonResponse({ json: { ok: true }, setCookie: ["admin_session="] }),
  );
  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
  assert.deepEqual(result, { ok: false, error: NO_SESSION_COOKIE });
});

test("login 200 picks the admin_session line by NAME, order-free", async () => {
  for (const lines of [
    ["csrf_state=first", FULL_COOKIE],
    [FULL_COOKIE, "csrf_state=second"],
  ]) {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse({ json: { ok: true }, setCookie: lines }),
    );
    const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
    assert.equal(result.ok, true);
    assert.equal(result.cookie.name, ADMIN_COOKIE_NAME);
    assert.equal(result.cookie.value, "TOKEN123");
  }
});

test("login 503 'database not configured' -> the API's own text (retry slug territory)", async () => {
  const { fetchImpl } = mockFetch(() =>
    jsonResponse({
      status: 503,
      json: { error: "database not configured: set DATABASE_URL" },
    }),
  );
  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
  assert.deepEqual(result, {
    ok: false,
    error: "database not configured: set DATABASE_URL",
  });
});

test("loginErrorSlug: credential verdicts vs retry-later, never a false 'wrong password'", () => {
  assert.equal(loginErrorSlug("invalid username or password"), "invalid");
  assert.equal(loginErrorSlug("username and password required"), "form");
  assert.equal(
    loginErrorSlug("too many concurrent login attempts; retry shortly"),
    "busy",
  );
  assert.equal(
    loginErrorSlug("admin sessions not configured: set SESSION_SECRET (>= 32 bytes)"),
    "notready",
  );
  assert.equal(loginErrorSlug("admin auth not ready; retry later"), "notready");
  // Infrastructure failures AND relay bugs are RETRY guidance, never a
  // credential verdict: the API rejects XRW-less requests BEFORE judging
  // credentials, so "missing X-Requested-With header" is a relay bug, and
  // unknown strings default to retry guidance too (review finding).
  assert.equal(loginErrorSlug(API_UNREACHABLE), "network");
  assert.equal(loginErrorSlug(NO_SESSION_COOKIE), "network");
  assert.equal(loginErrorSlug("database unavailable"), "network");
  assert.equal(loginErrorSlug("database not configured: set DATABASE_URL"), "network");
  assert.equal(
    loginErrorSlug("admin API unreachable or unhealthy; sign in again"),
    "network",
  );
  assert.equal(loginErrorSlug("missing X-Requested-With header"), "network");
  // Unknown verdict: retry guidance, never a false "wrong password".
  assert.equal(loginErrorSlug("something unexpected"), "network");
});

test("login whose BODY stalls after headers still succeeds: the cookie IS the session", async () => {
  // Headers + Set-Cookie arrive; json() never settles. The abort budget
  // (requestJson races the body read against the SAME abort event) settles
  // the call at the knob instead of hanging — and login needs only the
  // status line + Set-Cookie.
  process.env.NEXT_PUBLIC_FETCH_TIMEOUT_MS = "100";
  const stalled = {
    status: 200,
    json: () => new Promise(() => {}),
    headers: {
      getSetCookie: () => [FULL_COOKIE],
      get: () => null,
    },
  };
  const { fetchImpl } = mockFetch(() => stalled);
  const started = Date.now();
  const result = await adminLogin("https://api.test", "u", "p", fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.cookie.value, "TOKEN123");
  assert.ok(Date.now() - started < 5000, "must not hang past the abort budget");
});

test("whoami whose BODY stalls after headers -> unhealthy (fail closed), no hang", async () => {
  process.env.NEXT_PUBLIC_FETCH_TIMEOUT_MS = "100";
  const stalled = {
    status: 200,
    json: () => new Promise(() => {}),
    headers: { getSetCookie: () => [], get: () => null },
  };
  const { fetchImpl } = mockFetch(() => stalled);
  const started = Date.now();
  const result = await adminWhoami("https://api.test", "tok", fetchImpl);
  assert.deepEqual(result, {
    ok: false,
    error: "admin API unreachable or unhealthy; sign in again",
  });
  assert.ok(Date.now() - started < 5000, "must not hang past the abort budget");
});

/*
  Pure unit tests for the live availability route handler
  (app/api/availability/route.ts). No server and no network: global fetch is
  mocked per scenario and restored after; GET() is invoked directly.

  Contract asserted (commitment 5b, review finding 1, fail-closed):
  - healthy confirmed upstream -> 200 { ok: true, availability: { slug: n } }
    with cache-control: no-store
  - the healthy-to-failing transition: the same route turns around and fails
    closed the moment the upstream stops being confirmable (503 { ok: false }),
    proving no data lingers between calls (this is the transition the review
    asked for; ISR staleness cannot happen here because nothing is cached)
  - ANY failure -> 503 { ok: false }: network error, non-200 upstream,
    malformed JSON, non-array body, unconfirmable rows, env unset. Never a
    throw, never a partial map.
  - every 503 logs a server-side discrepancy report with a timestamp
    (the "discrepancy is reported rather than silently served" leg).
*/

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/availability/route.ts";

const originalFetch = globalThis.fetch;
const originalEnv = process.env.NEXT_PUBLIC_API_URL;
const originalConsoleError = console.error;

let logged;

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  logged = undefined;
  if (originalEnv === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalEnv;
  }
});

/** Replace fetch with a mock; the mock is restored in afterEach. */
function mockFetch(impl) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return impl(url, init);
  };
  return calls;
}

/** Capture console.error output for the reporting assertions. */
function captureConsoleError() {
  logged = [];
  console.error = (...args) => logged.push(args.join(" "));
}

/** Minimal Response stand-in for a JSON body (or a json() that rejects). */
function jsonResponse({ status = 200, json } = {}) {
  return { status, json };
}

const validRows = [
  {
    id: 1,
    slug: "panthella-160-v3-beige",
    stock_total: 2,
    stock_reserved: 1,
  },
  {
    id: 2,
    slug: "ph-3-2-table-chrome",
    stock_total: 1,
    stock_reserved: 1,
  },
];

test("healthy upstream -> 200 with the confirmed availability map", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  const calls = mockFetch(async () => jsonResponse({ json: async () => validRows }));
  captureConsoleError();

  const res = await GET();

  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control"), /no-store/);
  const body = await res.json();
  assert.deepEqual(body, {
    ok: true,
    availability: {
      "panthella-160-v3-beige": 1,
      "ph-3-2-table-chrome": 0,
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.test/api/products");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(logged.length, 0, "a confirmed response must not log a failure");
});

test("healthy to failing transition: second call fails closed with 503", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  captureConsoleError();

  // Healthy first: confirmed numbers are served.
  mockFetch(async () => jsonResponse({ json: async () => validRows }));
  const healthy = await GET();
  assert.equal(healthy.status, 200);
  const confirmed = await healthy.json();
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.availability["panthella-160-v3-beige"], 1);

  // Then the upstream starts failing: the very next call must fail closed,
  // with no lingering confirmed data from the previous response.
  mockFetch(async () => {
    throw new TypeError("fetch failed");
  });
  const failing = await GET();
  assert.equal(failing.status, 503);
  assert.deepEqual(await failing.json(), { ok: false });

  // The discrepancy is reported, not silently served (commitment 5b).
  assert.equal(logged.length, 1);
  assert.match(logged[0], /20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d/);
});

test("network rejection -> 503 { ok: false }, never throws", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  mockFetch(async () => {
    throw new TypeError("fetch failed");
  });
  captureConsoleError();

  const res = await GET();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false });
  assert.equal(logged.length, 1);
  assert.match(logged[0], /20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d/);
});

test("non-200 upstream -> 503", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  captureConsoleError();
  for (const status of [201, 404, 500, 503]) {
    mockFetch(async () => jsonResponse({ status, json: async () => validRows }));
    const res = await GET();
    assert.equal(res.status, 503, `upstream status ${status} must fail closed`);
    assert.deepEqual(await res.json(), { ok: false });
  }
});

test("malformed JSON -> 503", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  mockFetch(async () =>
    jsonResponse({
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    }),
  );
  captureConsoleError();

  const res = await GET();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false });
});

test("non-array body -> 503 (never a partial map)", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  mockFetch(async () =>
    jsonResponse({ json: async () => ({ ok: true, availability: {} }) }),
  );
  captureConsoleError();

  const res = await GET();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false });
});

test("one unconfirmable row -> 503 (never a partial map)", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  mockFetch(async () =>
    jsonResponse({
      json: async () => [validRows[0], { slug: "a", stock_total: 1, stock_reserved: 2 }],
    }),
  );
  captureConsoleError();

  const res = await GET();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false });
});

test("NEXT_PUBLIC_API_URL unset -> 503 without calling fetch, still logged", async () => {
  delete process.env.NEXT_PUBLIC_API_URL;
  const calls = mockFetch(async () => {
    throw new Error("fetch must not be called without an API base");
  });
  captureConsoleError();

  const res = await GET();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false });
  assert.equal(calls.length, 0);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d/);
});

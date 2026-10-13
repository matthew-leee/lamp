/*
  Pure unit tests for the availability client (lib/availability.ts). No
  server and no network: global fetch is mocked per test and restored after.

  Contract asserted (Vision.md DATA-01, STOCK-01, commitment 5b):
  - a confirmed response maps slug -> stock_total - stock_reserved
  - the request targets ${NEXT_PUBLIC_API_URL}/api/products with
    next: { revalidate: 60 } (ISR, stale at most 60s)
  - ANY failure (env unset, network error, non-200, malformed JSON, unknown
    shape, unconfirmable stock) yields null, never a throw and never a number
    the page could mistake for confirmed stock
*/

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchAvailability } from "../lib/availability.ts";

const originalFetch = globalThis.fetch;
const originalEnv = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
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

/** Minimal Response stand-in for a JSON body (or a json() that rejects). */
function jsonResponse({ status = 200, json, ok } = {}) {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    json,
  };
}

const validRows = [
  {
    id: 1,
    slug: "panthella-160-v3-beige",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    colourway: "Beige",
    price_cents: 161500,
    stock_total: 2,
    stock_reserved: 1,
    created_at: "2026-10-12T00:00:00Z",
  },
  {
    id: 2,
    slug: "ph-3-2-table-chrome",
    brand: "Louis Poulsen",
    model: "PH 3/2 Table",
    colourway: "Chrome",
    price_cents: 1037000,
    stock_total: 1,
    stock_reserved: 1,
    created_at: "2026-10-12T00:00:00Z",
  },
];

test("confirmed rows map slug -> stock_total - stock_reserved", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  const calls = mockFetch(async () =>
    jsonResponse({ json: async () => validRows }),
  );

  const result = await fetchAvailability();

  assert.ok(result instanceof Map);
  assert.equal(result.size, 2);
  assert.equal(result.get("panthella-160-v3-beige"), 1);
  assert.equal(result.get("ph-3-2-table-chrome"), 0);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.test/api/products");
  assert.deepEqual(calls[0].init.next, { revalidate: 60 });
});

test("trailing slash on the API base still builds a clean URL", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test/";
  const calls = mockFetch(async () => jsonResponse({ json: async () => [] }));

  const result = await fetchAvailability();

  assert.ok(result instanceof Map);
  assert.equal(result.size, 0, "confirmed empty catalogue is an empty map");
  assert.equal(calls[0].url, "https://api.test/api/products");
});

test("NEXT_PUBLIC_API_URL unset: null without calling fetch", async () => {
  delete process.env.NEXT_PUBLIC_API_URL;
  const calls = mockFetch(async () => {
    throw new Error("fetch must not be called without an API base");
  });

  const result = await fetchAvailability();

  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test("blank NEXT_PUBLIC_API_URL: null without calling fetch", async () => {
  process.env.NEXT_PUBLIC_API_URL = "   ";
  const calls = mockFetch(async () => {
    throw new Error("fetch must not be called without an API base");
  });

  assert.equal(await fetchAvailability(), null);
  assert.equal(calls.length, 0);
});

test("network rejection: null, never throws", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  mockFetch(async () => {
    throw new TypeError("fetch failed");
  });

  assert.equal(await fetchAvailability(), null);
});

test("non-200 response: null", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  for (const status of [201, 404, 500, 503]) {
    mockFetch(async () =>
      jsonResponse({ status, json: async () => validRows }),
    );
    assert.equal(await fetchAvailability(), null, `status ${status} yields null`);
  }
});

test("malformed JSON: null", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  mockFetch(async () =>
    jsonResponse({
      json: async () => {
        throw new SyntaxError("Unexpected token '<', ... is not valid JSON");
      },
    }),
  );

  assert.equal(await fetchAvailability(), null);
});

test("non-array body: null", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  mockFetch(async () =>
    jsonResponse({ json: async () => ({ error: "database unavailable" }) }),
  );

  assert.equal(await fetchAvailability(), null);
});

test("malformed rows: null (nothing is confirmable)", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  const badRows = [
    null,
    "panthella-160-v3-beige",
    { slug: 7, stock_total: 2, stock_reserved: 0 },
    { slug: "", stock_total: 2, stock_reserved: 0 },
    { slug: "a", stock_total: "2", stock_reserved: 0 },
    { slug: "a", stock_total: 2.5, stock_reserved: 0 },
    { slug: "a", stock_total: 2, stock_reserved: "0" },
    { slug: "a", stock_total: 2 }, // stock_reserved missing
  ];
  for (const bad of badRows) {
    mockFetch(async () => jsonResponse({ json: async () => [validRows[0], bad] }));
    assert.equal(
      await fetchAvailability(),
      null,
      `row ${JSON.stringify(bad)} yields null`,
    );
  }
});

test("unconfirmable stock numbers: null", async () => {
  process.env.NEXT_PUBLIC_API_URL = "https://api.test";
  const badStock = [
    { slug: "a", stock_total: -1, stock_reserved: 0 },
    { slug: "a", stock_total: 1, stock_reserved: -1 },
    { slug: "a", stock_total: 1, stock_reserved: 2 },
    { slug: "a", stock_total: 1.0, stock_reserved: NaN },
    { slug: "a", stock_total: Infinity, stock_reserved: 0 },
  ];
  for (const row of badStock) {
    mockFetch(async () => jsonResponse({ json: async () => [row] }));
    assert.equal(
      await fetchAvailability(),
      null,
      `stock ${JSON.stringify(row)} yields null`,
    );
  }
});

/*
  Pure unit tests for the settings mutation DISPATCH
  (lib/admin-settings.ts `dispatchSettingAction`): the exact request the
  relay route sends to the Rust API. No server and no network — fetch is
  INJECTED per scenario, recording url/method/headers/body for assertions.

  Contract asserted (D2b task 3; D2a endpoints read from
  api/src/admin_crud.rs at implementation time):
  - save  -> PUT /api/admin/settings/<key> with JSON body {"value": <value>}
  - off   -> the same PUT with {"value": ""} (presence-wins explicit OFF)
  - revert-> DELETE /api/admin/settings/<key> (no meaningful body; the D2a
    delete handler extracts none)
  - the KEY is URL-path-encoded (encodeURIComponent)
  - every call carries Cookie: admin_session=<value> AND the
    X-Requested-With CSRF header + a JSON content-type (adminMutate)
  - slug mapping incl. DELETE 404 "settings override not found" -> saved
    (idempotent revert), 400 -> invalid, 401 -> notauthenticated, network
    failure -> network (savedKey null unless saved)

  The route file stays thin (like the login relay): guard -> session ->
  form -> dispatch -> 303 slug redirect.
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dispatchSettingAction,
} from "../lib/admin-settings.ts";

const API = "http://api.test";
const SESSION = "session-token-value";

/** Mock fetch returning one canned response; records the calls it got. */
function mockFetch(status, body) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body,
    });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
    });
  };
  return { calls, fetchImpl };
}

test("save: PUT with JSON value body to /api/admin/settings/<key>, cookie + XRW", async () => {
  const { calls, fetchImpl } = mockFetch(200, {
    key: "brand.name",
    value: "New Brand",
    updated_at: "2026-01-01T00:00:00Z",
  });
  const result = await dispatchSettingAction(
    `${API}/`,
    "brand.name",
    "save",
    "New Brand",
    SESSION,
    fetchImpl,
  );

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, `${API}/api/admin/settings/brand.name`);
  assert.equal(call.method, "PUT");
  assert.equal(call.body, JSON.stringify({ value: "New Brand" }));
  assert.equal(call.headers.cookie, `admin_session=${SESSION}`);
  assert.equal(call.headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(call.headers["content-type"], "application/json");

  assert.deepEqual(result, { slug: "saved", savedKey: "brand.name" });
});

test("off: same PUT with the EMPTY value (explicit OFF, presence-wins)", async () => {
  const { calls, fetchImpl } = mockFetch(200, {
    key: "contact.whatsapp",
    value: "",
    updated_at: "2026-01-01T00:00:00Z",
  });
  const result = await dispatchSettingAction(
    API,
    "contact.whatsapp",
    "off",
    "85291234567",
    SESSION,
    fetchImpl,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].body, JSON.stringify({ value: "" }));
  assert.deepEqual(result, { slug: "saved", savedKey: "contact.whatsapp" });
});

test("revert: DELETE /api/admin/settings/<key> (no body needed)", async () => {
  const { calls, fetchImpl } = mockFetch(200, { ok: true });
  const result = await dispatchSettingAction(
    API,
    "analytics.gsc_verification",
    "revert",
    "",
    SESSION,
    fetchImpl,
  );

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(
    call.url,
    `${API}/api/admin/settings/analytics.gsc_verification`,
  );
  assert.equal(call.method, "DELETE");
  assert.equal(call.headers.cookie, `admin_session=${SESSION}`);
  assert.equal(call.headers["X-Requested-With"], "XMLHttpRequest");
  assert.deepEqual(result, {
    slug: "saved",
    savedKey: "analytics.gsc_verification",
  });
});

test("the key is URL-path-encoded into the API path", async () => {
  const { calls, fetchImpl } = mockFetch(200, {});
  await dispatchSettingAction(API, "odd key/segment", "save", "v", SESSION, fetchImpl);
  assert.equal(calls[0].url, `${API}/api/admin/settings/odd%20key%2Fsegment`);
  // The whitelist keys themselves are URL-safe and pass through unchanged.
  const again = mockFetch(200, {});
  await dispatchSettingAction(API, "site.url", "save", "v", SESSION, again.fetchImpl);
  assert.equal(again.calls[0].url, `${API}/api/admin/settings/site.url`);
});

test("revert + DELETE 404 not-found -> saved (idempotent revert)", async () => {
  // LITERAL string (not the exported constant): an independent pin of the
  // Rust contract body — api/src/admin_crud.rs delete_setting answers
  // {"error":"settings override not found"}.
  const { fetchImpl } = mockFetch(404, { error: "settings override not found" });
  const result = await dispatchSettingAction(
    API,
    "currency",
    "revert",
    "",
    SESSION,
    fetchImpl,
  );
  assert.deepEqual(result, { slug: "saved", savedKey: "currency" });
});

test("OFF then Save with a value turns the key back ON (the OFF row's input is submitable, never disabled)", async () => {
  // The OFF -> ON path (review finding): the page renders the OFF row's
  // input MUTED but enabled, so typing a value and pressing Save PUTs it
  // directly — the empty override persists until the nonempty save.
  const { calls, fetchImpl } = mockFetch(200, {});
  const off = await dispatchSettingAction(
    API,
    "contact.whatsapp",
    "off",
    "",
    SESSION,
    fetchImpl,
  );
  assert.deepEqual(off, { slug: "saved", savedKey: "contact.whatsapp" });
  assert.equal(JSON.parse(calls[0].body).value, "");

  const on = await dispatchSettingAction(
    API,
    "contact.whatsapp",
    "save",
    "85291234567",
    SESSION,
    fetchImpl,
  );
  assert.deepEqual(on, { slug: "saved", savedKey: "contact.whatsapp" });
  assert.equal(JSON.parse(calls[1].body).value, "85291234567");
  assert.equal(calls[1].method, "PUT");
});

test("a 404 of any other shape -> network, no saved key", async () => {
  const unknown = mockFetch(404, { error: "something else" });
  assert.deepEqual(
    await dispatchSettingAction(API, "currency", "revert", "", SESSION, unknown.fetchImpl),
    { slug: "network", savedKey: null },
  );
  const unreadable = mockFetch(404, undefined);
  assert.deepEqual(
    await dispatchSettingAction(API, "currency", "revert", "", SESSION, unreadable.fetchImpl),
    { slug: "network", savedKey: null },
  );
});

test("slug mapping through the dispatch: 400 invalid, 401 notauthenticated", async () => {
  const invalid = mockFetch(400, {
    error: "currency must be three uppercase letters (ISO 4217)",
  });
  assert.deepEqual(
    await dispatchSettingAction(API, "currency", "save", "hk$", SESSION, invalid.fetchImpl),
    { slug: "invalid", savedKey: null },
  );

  const required = mockFetch(400, { error: "brand.name cannot be empty" });
  assert.deepEqual(
    await dispatchSettingAction(API, "brand.name", "off", "", SESSION, required.fetchImpl),
    { slug: "invalid", savedKey: null },
    "the API rejects an empty required value; the slug is honest",
  );

  const expired = mockFetch(401, { error: "not authenticated" });
  assert.deepEqual(
    await dispatchSettingAction(API, "currency", "save", "HKD", SESSION, expired.fetchImpl),
    { slug: "notauthenticated", savedKey: null },
  );
});

test("network failure / 5xx -> network, never a claimed save", async () => {
  const down = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.deepEqual(
    await dispatchSettingAction(API, "currency", "save", "HKD", SESSION, down),
    { slug: "network", savedKey: null },
  );

  const unhealthy = mockFetch(503, { error: "database unavailable" });
  assert.deepEqual(
    await dispatchSettingAction(API, "currency", "save", "HKD", SESSION, unhealthy.fetchImpl),
    { slug: "network", savedKey: null },
  );
});

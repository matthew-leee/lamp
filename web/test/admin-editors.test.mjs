/*
  Pure unit tests for the task-4 editor data layer (lib/admin-editors.ts):
  the editorSlug mapping, the product/audit/site-content parse models, the
  form metadata, and EVERY dispatcher's exact request to the Rust API. No
  server, no network — fetch is INJECTED per scenario via mockFetch(status,
  body), which records url/method/headers/body (same convention as
  test/admin-settings-relay.test.mjs).

  Contract asserted (D2b task 4, ADMIN-01; D2a endpoints read from
  api/src/admin_crud.rs at implementation time):
  - editorSlug: 200/204 -> saved; 400 -> invalid; 401 -> notauthenticated;
    403 -> network (the XRW relay bug — the API rejects XRW-less requests
    BEFORE judging anything, so it is never a value verdict; "invalid"
    would claim the field was judged); 404 -> notfound
    (status-only: these relays only target known rows); 409 -> conflict;
    everything else incl. status 0 -> network
  - the exact D2a 404/409 contract strings are pinned as INDEPENDENT
    LITERALS (typed from the Rust source, never read back from the exported
    constants) — one test per literal
  - parseAdminProducts / parseAuditLog / parseSiteContentMap: valid rows
    parse exactly; ANY malformed row -> null (a partial list is a lie)
  - every dispatcher: exact path (incl. encodeURIComponent on the
    site-content delete), exact method (POST/PUT/PATCH/DELETE), cookie +
    X-Requested-With + JSON content-type, body EXACTLY the D2a DTO shape
    (create full; update ONLY the provided keys), 200 -> {slug:"saved",
    savedKey} with the documented savedKey convention, 409 -> conflict,
    404 -> notfound, 5xx/network -> {slug:"network", savedKey:null}
  - dispatchGetAuditLog -> adminGet {status, json} (never throws)

  NB: the DB-mutating behavioral editor suites are D2c/D2b-live-gate scope
  (same documented decision as task 3): round A is covered by these unit
  tests plus the architect gate.
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SITE_CONTENT_LOCALES,
  PIECE_NO_CONFLICT,
  PIECE_NOT_FOUND,
  PRODUCT_ART_VARIANTS,
  PRODUCT_CONTENT_FIELDS,
  PRODUCT_FIELDS,
  PRODUCT_NOT_FOUND,
  PRODUCT_SLUG_CONFLICT,
  REFERENCE_PRICE_NOT_FOUND,
  SITE_CONTENT_NOT_FOUND,
  dispatchCreatePiece,
  dispatchCreateProduct,
  dispatchDeletePiece,
  dispatchDeleteReferencePrice,
  dispatchDeleteSiteContent,
  dispatchGetAuditLog,
  dispatchReassignPiece,
  dispatchUpdateProduct,
  dispatchUpsertProductContent,
  dispatchUpsertReferencePrice,
  dispatchUpsertSiteContent,
  editorSlug,
  isProductArtVariant,
  isTransportSafeKey,
  parseAdminProduct,
  parseAdminProducts,
  parseAuditLog,
  parseSiteContentMap,
} from "../lib/admin-editors.ts";

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

/* ------------------------------------------------------------------ */
/* editorSlug                                                          */
/* ------------------------------------------------------------------ */

test("editorSlug: 200/204 -> saved", () => {
  assert.equal(editorSlug(200, { ok: true }), "saved");
  assert.equal(editorSlug(204, null), "saved");
});

test("editorSlug: 400 -> invalid (the API judged the value), 401 -> notauthenticated", () => {
  assert.equal(editorSlug(400, { error: "value cannot be empty" }), "invalid");
  assert.equal(editorSlug(401, { error: "not authenticated" }), "notauthenticated");
});

test("editorSlug: 403 -> network (XRW relay bug — retry guidance, never a value verdict)", () => {
  // The API's CSRF middleware rejects XRW-less requests BEFORE judging
  // anything; a relay bug is never a verdict on the operator's value or
  // session, and "invalid" would claim the field was judged — it was not:
  // retry guidance, consistent with the login relay's mapping.
  assert.equal(editorSlug(403, { error: "missing X-Requested-With header" }), "network");
  assert.equal(editorSlug(403, null), "network");
});

test("editorSlug: 404 -> notfound regardless of body (status-only; relays only target known rows)", () => {
  assert.equal(editorSlug(404, { error: "reference price not found" }), "notfound");
  assert.equal(editorSlug(404, { error: "something else entirely" }), "notfound");
  assert.equal(editorSlug(404, null), "notfound");
});

test("editorSlug: 409 -> conflict", () => {
  assert.equal(editorSlug(409, { error: "slug already in use" }), "conflict");
  assert.equal(editorSlug(409, null), "conflict");
});

test("editorSlug: everything else incl. 201/429/5xx and status 0 -> network", () => {
  assert.equal(editorSlug(201, null), "network", "only 200/204 are saves");
  assert.equal(editorSlug(202, null), "network");
  assert.equal(editorSlug(429, { error: "slow down" }), "network");
  assert.equal(editorSlug(500, { error: "boom" }), "network");
  assert.equal(editorSlug(503, { error: "database unavailable" }), "network");
  assert.equal(editorSlug(0, null), "network", "0 is not an HTTP status");
});

/* ------------------------------------------------------------------ */
/* Pinned D2a contract LITERALS (one test per literal, independent     */
/* from the exported constants — typed from api/src/admin_crud.rs)     */
/* ------------------------------------------------------------------ */

test('pinned LITERAL: product 404 body is exactly "product not found"', () => {
  // api/src/admin_crud.rs: update_product / upsert_product_content /
  // upsert_reference_price / create_piece / reassign_piece answer
  // {"error":"product not found"} for a missing product.
  assert.equal(PRODUCT_NOT_FOUND, "product not found");
});

test('pinned LITERAL: reference-price delete 404 body is exactly "reference price not found"', () => {
  // api/src/admin_crud.rs delete_reference_price.
  assert.equal(REFERENCE_PRICE_NOT_FOUND, "reference price not found");
});

test('pinned LITERAL: piece 404 body is exactly "piece not found"', () => {
  // api/src/admin_crud.rs delete_piece (and reassign_piece for a missing piece).
  assert.equal(PIECE_NOT_FOUND, "piece not found");
});

test('pinned LITERAL: site-content delete 404 body is exactly "site content row not found"', () => {
  // api/src/admin_crud.rs delete_site_content.
  assert.equal(SITE_CONTENT_NOT_FOUND, "site content row not found");
});

test('pinned LITERAL: product 409 body is exactly "slug already in use"', () => {
  // api/src/admin_crud.rs create_product / update_product (products_slug_key).
  assert.equal(PRODUCT_SLUG_CONFLICT, "slug already in use");
});

test('pinned LITERAL: piece 409 body is exactly "piece_no already exists"', () => {
  // api/src/admin_crud.rs create_piece (pieces_pkey).
  assert.equal(PIECE_NO_CONFLICT, "piece_no already exists");
});

/* ------------------------------------------------------------------ */
/* Closed value sets + form metadata                                   */
/* ------------------------------------------------------------------ */

test("PRODUCT_ART_VARIANTS is exactly dome|shades (D2a validate_art_variant)", () => {
  assert.deepEqual([...PRODUCT_ART_VARIANTS], ["dome", "shades"]);
  assert.equal(isProductArtVariant("dome"), true);
  assert.equal(isProductArtVariant("shades"), true);
  assert.equal(isProductArtVariant("bogus"), false);
  assert.equal(isProductArtVariant(""), false);
  assert.equal(isProductArtVariant(undefined), false);
});

test("PRODUCT_CONTENT_FIELDS is exactly model_alt|colourway|heritage|electrical (D2a validate_product_content)", () => {
  assert.deepEqual(
    [...PRODUCT_CONTENT_FIELDS],
    ["model_alt", "colourway", "heritage", "electrical"],
  );
});

test("DEFAULT_SITE_CONTENT_LOCALES is the documented en,zh-HK default pair (LOCALES-env-overridable)", () => {
  assert.deepEqual([...DEFAULT_SITE_CONTENT_LOCALES], ["en", "zh-HK"]);
});

test("PRODUCT_FIELDS: both groups cover every DTO field, in DTO order", () => {
  const keys = ["slug", "brand", "model", "price_cents", "family", "art_variant", "art_hue", "active"];
  assert.deepEqual(PRODUCT_FIELDS.createRequired.map((f) => f.key), keys);
  assert.deepEqual(PRODUCT_FIELDS.patchOptional.map((f) => f.key), keys);
});

test("PRODUCT_FIELDS: every field carries an English label + hint (admin is English-only)", () => {
  for (const field of PRODUCT_FIELDS.createRequired) {
    assert.equal(typeof field.label, "string");
    assert.ok(field.label.trim() !== "", `${field.key} needs a label`);
    assert.ok(field.hint.trim() !== "", `${field.key} needs a hint`);
  }
  // The brief's exact hint shapes.
  const byKey = new Map(PRODUCT_FIELDS.createRequired.map((f) => [f.key, f]));
  assert.equal(byKey.get("slug").hint, "URL path, lowercase-with-dashes");
  assert.equal(
    byKey.get("price_cents").hint,
    "integer minor units, e.g. 161500 = HK$1,615",
  );
  assert.equal(byKey.get("art_hue").hint, "integer hue");
  // Input controls: active is a boolean checkbox, art_variant a select.
  assert.equal(byKey.get("active").input, "checkbox");
  assert.equal(byKey.get("art_variant").input, "select");
  assert.equal(byKey.get("slug").input, "text");
  assert.equal(byKey.get("price_cents").input, "integer");
});

/* ------------------------------------------------------------------ */
/* parseAdminProduct / parseAdminProducts                              */
/* ------------------------------------------------------------------ */

const PRODUCT_ROW = {
  id: 7,
  slug: "ph-5",
  brand: "Louis Poulsen",
  model: "PH 5",
  price_cents: 161500,
  family: "PH",
  art_variant: "dome",
  art_hue: 210,
  active: true,
  stock_total: 16,
  stock_reserved: 1,
  created_at: "2026-01-01T00:00:00Z",
};

test("parseAdminProduct: a full valid row parses exactly (created_at stays an ISO string)", () => {
  assert.deepEqual(parseAdminProduct(PRODUCT_ROW), PRODUCT_ROW);
});

test("parseAdminProduct: an empty family is valid (the D2a create rule allows it)", () => {
  const row = { ...PRODUCT_ROW, family: "" };
  assert.deepEqual(parseAdminProduct(row), row);
});

test("parseAdminProduct: any malformed field -> null (fail-loud, no partial rows)", () => {
  const bads = [
    ["non-object", 7],
    ["null", null],
    ["array", [1, 2]],
    ["missing id", (() => { const r = { ...PRODUCT_ROW }; delete r.id; return r; })()],
    ["id 0", { ...PRODUCT_ROW, id: 0 }],
    ["id non-integer", { ...PRODUCT_ROW, id: 1.5 }],
    ["id string", { ...PRODUCT_ROW, id: "7" }],
    ["slug empty", { ...PRODUCT_ROW, slug: "" }],
    ["brand blank", { ...PRODUCT_ROW, brand: "   " }],
    ["model missing", (() => { const r = { ...PRODUCT_ROW }; delete r.model; return r; })()],
    ["price_cents negative", { ...PRODUCT_ROW, price_cents: -1 }],
    ["price_cents string", { ...PRODUCT_ROW, price_cents: "161500" }],
    ["family wrong type", { ...PRODUCT_ROW, family: 3 }],
    ["art_variant outside the set", { ...PRODUCT_ROW, art_variant: "bogus" }],
    ["art_hue 360", { ...PRODUCT_ROW, art_hue: 360 }],
    ["art_hue -1", { ...PRODUCT_ROW, art_hue: -1 }],
    ["active string", { ...PRODUCT_ROW, active: "true" }],
    ["stock_total negative", { ...PRODUCT_ROW, stock_total: -1 }],
    ["stock_reserved non-integer", { ...PRODUCT_ROW, stock_reserved: 1.5 }],
    ["created_at empty", { ...PRODUCT_ROW, created_at: "" }],
  ];
  for (const [what, row] of bads) {
    assert.equal(parseAdminProduct(row), null, `must reject: ${what}`);
  }
});

test("parseAdminProducts: a valid list parses every row", () => {
  const rows = [PRODUCT_ROW, { ...PRODUCT_ROW, id: 8, slug: "artichoke-1958" }];
  const parsed = parseAdminProducts(rows);
  assert.deepEqual(parsed, rows);
});

test("parseAdminProducts: empty list is valid (a shop with no products yet)", () => {
  assert.deepEqual(parseAdminProducts([]), []);
});

test("parseAdminProducts: non-array -> null; ONE malformed row -> null (a partial list is a lie)", () => {
  assert.equal(parseAdminProducts(null), null);
  assert.equal(parseAdminProducts({ products: [] }), null);
  assert.equal(parseAdminProducts("[]"), null);
  assert.equal(parseAdminProducts([PRODUCT_ROW, { ...PRODUCT_ROW, id: 0 }]), null);
  assert.equal(parseAdminProducts([PRODUCT_ROW, "junk"]), null);
});

/* ------------------------------------------------------------------ */
/* parseAuditLog                                                       */
/* ------------------------------------------------------------------ */

const AUDIT_ROWS = [
  {
    id: 3,
    actor: "founder",
    action: "upsert",
    entity: "site_content",
    entity_id: "tagline/en",
    detail: { key: "tagline", locale: "en" },
    created_at: "2026-01-02T03:04:05Z",
  },
  {
    id: 2,
    actor: "founder",
    action: "delete",
    entity: "reference_prices",
    entity_id: null,
    detail: null,
    created_at: "2026-01-01T00:00:00Z",
  },
];

test("parseAuditLog: valid rows parse exactly, incl. null entity_id and null detail", () => {
  assert.deepEqual(parseAuditLog(AUDIT_ROWS), AUDIT_ROWS);
});

test("parseAuditLog: detail is UNVALIDATED JSON passthrough (page renders it with a fallback)", () => {
  const rows = [
    { ...AUDIT_ROWS[0], id: 1, detail: { nested: { deep: [1, "two", null] } } },
    { ...AUDIT_ROWS[1], id: 2, detail: 42 },
    { ...AUDIT_ROWS[1], id: 3, detail: true },
  ];
  assert.deepEqual(parseAuditLog(rows), rows);
  // A missing detail key normalizes to null (never undefined).
  const missing = [{ ...AUDIT_ROWS[1], id: 4, detail: undefined }];
  delete missing[0].detail;
  assert.deepEqual(parseAuditLog(missing), [{ ...missing[0], detail: null }]);
});

test("parseAuditLog: any malformed row -> null (a partial audit trail is a lie)", () => {
  const bads = [
    ["non-object row", [7]],
    ["id 0", { ...AUDIT_ROWS[0], id: 0 }],
    ["id non-integer", { ...AUDIT_ROWS[0], id: 1.5 }],
    ["actor empty", { ...AUDIT_ROWS[0], actor: "" }],
    ["action missing", (() => { const r = { ...AUDIT_ROWS[0] }; delete r.action; return r; })()],
    ["entity blank", { ...AUDIT_ROWS[0], entity: " " }],
    ["entity_id number", { ...AUDIT_ROWS[0], entity_id: 42 }],
    ["entity_id empty string", { ...AUDIT_ROWS[0], entity_id: "" }],
    ["entity_id missing", (() => { const r = { ...AUDIT_ROWS[0] }; delete r.entity_id; return r; })()],
    ["created_at empty", { ...AUDIT_ROWS[0], created_at: "" }],
  ];
  for (const [what, row] of bads) {
    assert.equal(parseAuditLog([row]), null, `must reject: ${what}`);
  }
  assert.equal(parseAuditLog({ rows: [] }), null, "non-array input");
});

/* ------------------------------------------------------------------ */
/* parseSiteContentMap                                                 */
/* ------------------------------------------------------------------ */

test("parseSiteContentMap: valid nested {content:{key:{locale:value}}} parses exactly", () => {
  const json = {
    content: {
      tagline: { en: "Curated designer lighting", "zh-HK": "精選設計燈飾" },
      "policy.warranty": { en: "12-month own warranty" },
    },
  };
  assert.deepEqual(parseSiteContentMap(json), {
    tagline: { en: "Curated designer lighting", "zh-HK": "精選設計燈飾" },
    "policy.warranty": { en: "12-month own warranty" },
  });
});

test("parseSiteContentMap: an empty content map is valid", () => {
  assert.deepEqual(parseSiteContentMap({ content: {} }), {});
});

test("parseSiteContentMap: malformed shapes -> null (a partial map is a lie)", () => {
  assert.equal(parseSiteContentMap(null), null);
  assert.equal(parseSiteContentMap([]), null, "array top level");
  assert.equal(parseSiteContentMap("hi"), null);
  assert.equal(parseSiteContentMap({}), null, "missing content map");
  assert.equal(parseSiteContentMap({ content: null }), null);
  assert.equal(parseSiteContentMap({ content: [] }), null);
  assert.equal(parseSiteContentMap({ content: { tagline: "x" } }), null, "locale map not an object");
  assert.equal(parseSiteContentMap({ content: { tagline: { en: 5 } } }), null, "value not a string");
});

test("parseSiteContentMap: a __proto__ key becomes an OWN property (no prototype pollution)", () => {
  // Site content keys are admin-writable free text; the parse must never
  // SET a prototype through the __proto__ setter.
  const json = JSON.parse('{"content":{"__proto__":{"en":"x"},"tagline":{"en":"y"}}}');
  const out = parseSiteContentMap(json);
  assert.deepEqual(Object.keys(out), ["__proto__", "tagline"]);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(out["__proto__"], { en: "x" });
  assert.equal({}.en, undefined, "Object.prototype untouched");
});

/* ------------------------------------------------------------------ */
/* Dispatchers: every D2a write endpoint                               */
/* ------------------------------------------------------------------ */

const FULL_PRODUCT_INPUT = {
  slug: "ph-5",
  brand: "Louis Poulsen",
  model: "PH 5",
  price_cents: 161500,
  family: "PH",
  art_variant: "dome",
  art_hue: 210,
  active: true,
};

/**
 * One case per D2a write endpoint: the call, the exact request shape and
 * the documented savedKey. `body` is written in D2a DTO key order — the
 * request-body assertion below is an EXACT string match.
 */
const DISPATCH_CASES = [
  {
    name: "create product",
    call: (fetchImpl) =>
      dispatchCreateProduct(`${API}/`, FULL_PRODUCT_INPUT, SESSION, fetchImpl),
    method: "POST",
    path: "/api/admin/products",
    body: FULL_PRODUCT_INPUT,
    savedKey: "product ph-5",
  },
  {
    name: "update product",
    call: (fetchImpl) =>
      dispatchUpdateProduct(
        API,
        7,
        { brand: "New Brand", price_cents: 99900, active: false },
        SESSION,
        fetchImpl,
      ),
    method: "PUT",
    path: "/api/admin/products/7",
    body: { brand: "New Brand", price_cents: 99900, active: false },
    savedKey: "product 7",
  },
  {
    name: "upsert product content",
    call: (fetchImpl) =>
      dispatchUpsertProductContent(
        API,
        { product_id: 12, locale: "zh-HK", field: "heritage", value: "丹麥設計傳承" },
        SESSION,
        fetchImpl,
      ),
    method: "PUT",
    path: "/api/admin/product-content",
    body: { product_id: 12, locale: "zh-HK", field: "heritage", value: "丹麥設計傳承" },
    savedKey: "12 zh-HK heritage",
  },
  {
    name: "upsert reference price",
    call: (fetchImpl) =>
      dispatchUpsertReferencePrice(
        API,
        3,
        {
          min_price_cents: 120000,
          max_price_cents: 180000,
          source_name: "Pricerite HK",
          source_url: "https://pricerite.hk/ph5",
          checked_on: "2026-01-05",
        },
        SESSION,
        fetchImpl,
      ),
    method: "PUT",
    path: "/api/admin/reference-prices/3",
    body: {
      min_price_cents: 120000,
      max_price_cents: 180000,
      source_name: "Pricerite HK",
      source_url: "https://pricerite.hk/ph5",
      checked_on: "2026-01-05",
    },
    savedKey: "reference price for product 3",
  },
  {
    name: "delete reference price",
    call: (fetchImpl) =>
      dispatchDeleteReferencePrice(API, 3, SESSION, fetchImpl),
    method: "DELETE",
    path: "/api/admin/reference-prices/3",
    body: {},
    savedKey: "reference price for product 3",
  },
  {
    name: "create piece",
    call: (fetchImpl) =>
      dispatchCreatePiece(API, { piece_no: 12, product_id: 2 }, SESSION, fetchImpl),
    method: "POST",
    path: "/api/admin/pieces",
    body: { piece_no: 12, product_id: 2 },
    savedKey: "piece 12",
  },
  {
    name: "reassign piece",
    call: (fetchImpl) =>
      dispatchReassignPiece(API, 12, 3, SESSION, fetchImpl),
    method: "PATCH",
    path: "/api/admin/pieces/12",
    body: { product_id: 3 },
    savedKey: "piece 12",
  },
  {
    name: "delete piece",
    call: (fetchImpl) => dispatchDeletePiece(API, 12, SESSION, fetchImpl),
    method: "DELETE",
    path: "/api/admin/pieces/12",
    body: {},
    savedKey: "piece 12",
  },
  {
    name: "upsert site content",
    call: (fetchImpl) =>
      dispatchUpsertSiteContent(
        API,
        { key: "policy.warranty", locale: "en", value: "12-month own warranty" },
        SESSION,
        fetchImpl,
      ),
    method: "PUT",
    path: "/api/admin/site-content",
    body: { key: "policy.warranty", locale: "en", value: "12-month own warranty" },
    savedKey: "policy.warranty (en)",
  },
  {
    name: "delete site content",
    call: (fetchImpl) =>
      dispatchDeleteSiteContent(API, "policy.warranty", "en", SESSION, fetchImpl),
    method: "DELETE",
    path: "/api/admin/site-content/policy.warranty/en",
    body: {},
    savedKey: "policy.warranty (en)",
  },
];

for (const c of DISPATCH_CASES) {
  test(`${c.name}: ${c.method} ${c.path} — exact D2a DTO body, cookie + X-Requested-With`, async () => {
    const { calls, fetchImpl } = mockFetch(200, {});
    const result = await c.call(fetchImpl);

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, `${API}${c.path}`);
    assert.equal(call.method, c.method);
    assert.equal(call.headers.cookie, `admin_session=${SESSION}`);
    assert.equal(call.headers["X-Requested-With"], "XMLHttpRequest");
    assert.equal(call.headers["content-type"], "application/json");
    // EXACT body: the D2a DTO shape and nothing else (exact string match
    // pins the key set AND the canonical DTO key order).
    assert.equal(call.body, JSON.stringify(c.body));
    assert.deepEqual(JSON.parse(call.body), c.body);

    assert.deepEqual(result, { slug: "saved", savedKey: c.savedKey });
  });

  test(`${c.name}: 409 -> conflict, 404 -> notfound (never a claimed save)`, async () => {
    const clash = mockFetch(409, { error: "uniqueness violation" });
    assert.deepEqual(await c.call(clash.fetchImpl), {
      slug: "conflict",
      savedKey: null,
    });

    // The slug mapping is status-only: the body text is irrelevant here.
    // The exact D2a 404/409 bodies are pinned as literals in the dedicated
    // tests below.
    const missing = mockFetch(404, { error: "any missing-row body" });
    assert.deepEqual(await c.call(missing.fetchImpl), {
      slug: "notfound",
      savedKey: null,
    });
  });

  test(`${c.name}: 5xx -> network; a network failure never throws and never claims a save`, async () => {
    const unhealthy = mockFetch(503, { error: "database unavailable" });
    assert.deepEqual(await c.call(unhealthy.fetchImpl), {
      slug: "network",
      savedKey: null,
    });

    const down = async () => {
      throw new Error("ECONNREFUSED");
    };
    assert.deepEqual(await c.call(down), { slug: "network", savedKey: null });
  });
}

test("update product: the patch body carries ONLY the provided keys (undefined omitted = unchanged)", async () => {
  const { calls, fetchImpl } = mockFetch(200, {});
  await dispatchUpdateProduct(
    API,
    7,
    // model: undefined is an ABSENT key (leave unchanged) and must not be
    // serialized; false/0 are real values and must survive.
    { brand: "New Brand", model: undefined, active: false, art_hue: 0 },
    SESSION,
    fetchImpl,
  );
  const body = JSON.parse(calls[0].body);
  assert.deepEqual(Object.keys(body), ["brand", "art_hue", "active"]);
  assert.deepEqual(body, { brand: "New Brand", art_hue: 0, active: false });
  assert.equal("model" in body, false);
  assert.equal("slug" in body, false);
});

test("update product: an empty patch sends {} and the API's 400 maps to invalid", async () => {
  // LITERAL string typed from api/src/admin_crud.rs validate_product_patch:
  // an empty patch must not fabricate an audit row, so it 400s with
  // {"error":"no fields to update"} — and the slug is honestly "invalid".
  const { calls, fetchImpl } = mockFetch(400, { error: "no fields to update" });
  const result = await dispatchUpdateProduct(API, 7, {}, SESSION, fetchImpl);
  assert.equal(calls[0].body, "{}");
  assert.deepEqual(result, { slug: "invalid", savedKey: null });
});

test("delete site content: BOTH path segments are encodeURIComponent'd", async () => {
  const { calls, fetchImpl } = mockFetch(200, { ok: true });
  const result = await dispatchDeleteSiteContent(
    API,
    "policy/warranty & returns",
    "zh-HK test/2",
    SESSION,
    fetchImpl,
  );
  // Expected encodings typed by hand (not via encodeURIComponent): the
  // test must not re-derive the implementation's own output.
  assert.equal(
    calls[0].url,
    `${API}/api/admin/site-content/policy%2Fwarranty%20%26%20returns/zh-HK%20test%2F2`,
  );
  assert.deepEqual(result, {
    slug: "saved",
    savedKey: "policy/warranty & returns (zh-HK test/2)",
  });

  // Plain keys pass through unencoded (dots and hyphens are URL-safe).
  const plain = mockFetch(200, { ok: true });
  await dispatchDeleteSiteContent(API, "policy.warranty", "zh-HK", SESSION, plain.fetchImpl);
  assert.equal(plain.calls[0].url, `${API}/api/admin/site-content/policy.warranty/zh-HK`);
});

test("upsert site content: special-character keys travel verbatim in the BODY (the body needs no encoding)", async () => {
  const { calls, fetchImpl } = mockFetch(200, {});
  await dispatchUpsertSiteContent(
    API,
    { key: "policy/warranty & returns", locale: "zh-HK", value: "換貨須知" },
    SESSION,
    fetchImpl,
  );
  assert.equal(calls[0].url, `${API}/api/admin/site-content`);
  assert.deepEqual(JSON.parse(calls[0].body), {
    key: "policy/warranty & returns",
    locale: "zh-HK",
    value: "換貨須知",
  });
});

test("the exact D2a 404/409 bodies flow through their dispatchers as literals", async () => {
  // Bodies below are LITERALS typed from api/src/admin_crud.rs — pinned
  // end-to-end, independent from the exported constants.
  const refPrice = mockFetch(404, { error: "reference price not found" });
  assert.deepEqual(
    await dispatchDeleteReferencePrice(API, 3, SESSION, refPrice.fetchImpl),
    { slug: "notfound", savedKey: null },
  );

  const piece = mockFetch(404, { error: "piece not found" });
  assert.deepEqual(
    await dispatchDeletePiece(API, 12, SESSION, piece.fetchImpl),
    { slug: "notfound", savedKey: null },
  );

  const siteContent = mockFetch(404, { error: "site content row not found" });
  assert.deepEqual(
    await dispatchDeleteSiteContent(API, "tagline", "en", SESSION, siteContent.fetchImpl),
    { slug: "notfound", savedKey: null },
  );

  const product = mockFetch(404, { error: "product not found" });
  assert.deepEqual(
    await dispatchUpdateProduct(API, 7, { active: true }, SESSION, product.fetchImpl),
    { slug: "notfound", savedKey: null },
  );

  const slugClash = mockFetch(409, { error: "slug already in use" });
  assert.deepEqual(
    await dispatchCreateProduct(API, FULL_PRODUCT_INPUT, SESSION, slugClash.fetchImpl),
    { slug: "conflict", savedKey: null },
  );

  const pieceClash = mockFetch(409, { error: "piece_no already exists" });
  assert.deepEqual(
    await dispatchCreatePiece(API, { piece_no: 12, product_id: 2 }, SESSION, pieceClash.fetchImpl),
    { slug: "conflict", savedKey: null },
  );
});

test("a 403 (XRW relay bug) flows through as network — retry guidance, never a value verdict", async () => {
  const { fetchImpl } = mockFetch(403, { error: "missing X-Requested-With header" });
  assert.deepEqual(
    await dispatchCreateProduct(API, FULL_PRODUCT_INPUT, SESSION, fetchImpl),
    { slug: "network", savedKey: null },
  );
});

test("every dispatcher resolves the closed slug set and never throws", async () => {
  for (const c of DISPATCH_CASES) {
    for (const [status, body] of [
      [200, {}],
      [204, undefined],
      [400, { error: "bad" }],
      [401, { error: "not authenticated" }],
      [403, { error: "missing X-Requested-With header" }],
      [404, { error: "gone" }],
      [409, { error: "clash" }],
      [500, { error: "boom" }],
    ]) {
      const { fetchImpl } = mockFetch(status, body);
      const result = await c.call(fetchImpl);
      assert.ok(
        ["saved", "invalid", "notauthenticated", "notfound", "conflict", "network"].includes(result.slug),
        `${c.name} on ${status}: unexpected slug ${result.slug}`,
      );
      if (result.slug !== "saved") {
        assert.equal(result.savedKey, null, `${c.name} on ${status}`);
      }
    }
  }
});

/* ------------------------------------------------------------------ */
/* dispatchGetAuditLog (a read: raw {status, json})                    */
/* ------------------------------------------------------------------ */

test("dispatchGetAuditLog: GET /api/admin/audit-log forwarding the cookie (no XRW — it is a read)", async () => {
  const { calls, fetchImpl } = mockFetch(200, AUDIT_ROWS);
  const result = await dispatchGetAuditLog(API, SESSION, fetchImpl);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API}/api/admin/audit-log`);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.cookie, `admin_session=${SESSION}`);
  assert.equal(calls[0].headers["X-Requested-With"], undefined);
  assert.equal(calls[0].body, undefined);

  assert.equal(result.status, 200);
  assert.deepEqual(parseAuditLog(result.json), AUDIT_ROWS);
});

test("dispatchGetAuditLog: non-200 and network pass through as {status, json} and never throw", async () => {
  const expired = mockFetch(401, { error: "not authenticated" });
  const unauthorized = await dispatchGetAuditLog(API, SESSION, expired.fetchImpl);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(unauthorized.json, { error: "not authenticated" });
  assert.equal(parseAuditLog(unauthorized.json), null);

  const down = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.deepEqual(await dispatchGetAuditLog(API, SESSION, down), {
    status: 0,
    json: null,
  });
});

test("site-content dot-segment keys are transport-unsafe -> invalid WITHOUT dispatch (isTransportSafeKey)", async () => {
  // Review finding: encodeURIComponent leaves "." and ".." unchanged, and
  // WHATWG URL parsing normalizes those path segments away — such a key can
  // be created but never addressed for DELETE. The web tier closes the edge
  // honestly: no fetch at all, slug "invalid".
  const { calls, fetchImpl } = mockFetch(200, {});
  for (const key of [".", ".."]) {
    assert.deepEqual(
      await dispatchUpsertSiteContent(API, { key, locale: "en", value: "v" }, SESSION, fetchImpl),
      { slug: "invalid", savedKey: null },
    );
    assert.deepEqual(
      await dispatchDeleteSiteContent(API, key, "en", SESSION, fetchImpl),
      { slug: "invalid", savedKey: null },
    );
  }
  // The mock was never called: no request left the tier.
  assert.equal(calls.length, 0);
  // Normal keys still dispatch.
  assert.equal(isTransportSafeKey("policy.warranty"), true);
});

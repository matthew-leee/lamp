/*
  Pure unit tests for the admin settings model (lib/admin-settings.ts): key
  sets/metadata, raw env defaults, presence-wins classification, row models
  and the mutation-result slug mapping. No server, no network, no
  process.env dependency: the env is INJECTED per scenario.

  Contract asserted (D2b task 3, founder toggle spec, ADMIN-01/SCOPE-01):
  - SETTINGS_KEYS is exactly the 7 public keys in the display order
    (brand.name, brand.name_native, site.url, contact.whatsapp, currency,
    analytics.ga_measurement_id, analytics.gsc_verification)
  - REQUIRED_KEYS = brand.name + site.url (no-toggle), CURRENCY_KEY has no
    OFF state, every key carries an English label + input hint
  - classifySetting is presence-wins: absent key -> none; PRESENT empty
    string -> off (explicitly OFF); present non-empty -> on (whitespace-only
    is ON — the API persists it as-is)
  - envDefaults maps the 7 NEXT_PUBLIC_* vars 1:1 (trimmed; unset/blank ->
    null)
  - settingRowModel rows: state/overrideValue/envDefault/effective per key;
    OFF renders "OFF (explicitly)" for optional keys and NEVER for required
    ones; none -> env default, else the code default where one exists
    (currency -> HKD); missingRequired flags a required key with neither
    override nor env default (the red warning)
  - relayActionSlug: 200/204 -> saved; 400 -> invalid; 401 ->
    notauthenticated; 404 + the DELETE not-found body -> saved (idempotent
    revert); any other 404 / 5xx / status 0 -> network

  NB: the DB-mutating behavioral settings suite is D2c scope (documented
  decision: it needs a scratch Postgres to avoid racing the storefront
  suites on the shared verify DB) — task 3 is covered by these unit tests
  plus the architect live gate.
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CURRENCY_KEY,
  OFF_EFFECTIVE,
  REQUIRED_KEYS,
  SETTINGS_KEYS,
  classifySetting,
  dispatchSettingAction,
  envDefaults,
  isSettingsKey,
  relayActionSlug,
  settingMeta,
  settingRowModel,
} from "../lib/admin-settings.ts";

/* ------------------------------------------------------------------ */
/* Key sets + metadata                                                 */
/* ------------------------------------------------------------------ */

test("SETTINGS_KEYS is exactly the 7 public keys in display order", () => {
  assert.deepEqual(
    [...SETTINGS_KEYS],
    [
      "brand.name",
      "brand.name_native",
      "site.url",
      "contact.whatsapp",
      "currency",
      "analytics.ga_measurement_id",
      "analytics.gsc_verification",
    ],
  );
});

test("REQUIRED_KEYS are the two no-toggle keys; currency is the no-OFF key", () => {
  assert.deepEqual([...REQUIRED_KEYS], ["brand.name", "site.url"]);
  assert.equal(CURRENCY_KEY, "currency");
  for (const key of REQUIRED_KEYS) {
    assert.ok(SETTINGS_KEYS.includes(key), `${key} must be a public key`);
    assert.notEqual(key, CURRENCY_KEY, "required keys are not the currency");
  }
});

test("every key carries an English label + hint (admin is English-only)", () => {
  for (const key of SETTINGS_KEYS) {
    const meta = settingMeta(key);
    assert.equal(typeof meta.label, "string");
    assert.ok(meta.label.trim() !== "", `${key} needs a label`);
    assert.ok(meta.hint.trim() !== "", `${key} needs an input hint`);
  }
  // The brief's exact hint shapes.
  assert.equal(settingMeta("currency").hint, "ISO 4217 code, e.g. HKD");
  assert.equal(
    settingMeta("contact.whatsapp").hint,
    "international digits, e.g. 85291234567",
  );
  assert.equal(
    settingMeta("analytics.ga_measurement_id").hint,
    "GA4 id, e.g. G-XXXXXXXXXX",
  );
  assert.equal(
    settingMeta("site.url").hint,
    "absolute URL, no trailing slash",
  );
});

test("isSettingsKey is the closed set (SCOPE-01)", () => {
  assert.equal(isSettingsKey("brand.name"), true);
  assert.equal(isSettingsKey("currency"), true);
  assert.equal(isSettingsKey("smtp.password"), false);
  assert.equal(isSettingsKey("__proto__"), false);
  assert.equal(isSettingsKey(""), false);
});

/* ------------------------------------------------------------------ */
/* classifySetting (presence-wins)                                     */
/* ------------------------------------------------------------------ */

test("classify: absent key -> none (revert to env default)", () => {
  assert.deepEqual(classifySetting({}, "brand.name"), { state: "none" });
  assert.deepEqual(classifySetting(null, "brand.name"), { state: "none" });
  assert.deepEqual(classifySetting(undefined, "brand.name"), {
    state: "none",
  });
});

test("classify: PRESENT empty string -> off (explicitly OFF, presence-wins)", () => {
  assert.deepEqual(classifySetting({ "brand.name_native": "" }, "brand.name_native"), {
    state: "off",
  });
});

test("classify: present non-empty -> on with the value", () => {
  assert.deepEqual(classifySetting({ currency: "HKD" }, "currency"), {
    state: "on",
    value: "HKD",
  });
});

test("classify: whitespace-only value is ON (only \"\" is OFF; the API persists whitespace as-is)", () => {
  assert.deepEqual(classifySetting({ "contact.whatsapp": " " }, "contact.whatsapp"), {
    state: "on",
    value: " ",
  });
});

/* ------------------------------------------------------------------ */
/* envDefaults                                                         */
/* ------------------------------------------------------------------ */

test("envDefaults maps the 7 NEXT_PUBLIC_* vars 1:1", () => {
  const env = {
    NEXT_PUBLIC_BRAND_NAME: "Brand",
    NEXT_PUBLIC_BRAND_NAME_NATIVE: "品牌",
    NEXT_PUBLIC_SITE_URL: "https://shop.example",
    NEXT_PUBLIC_WHATSAPP_NUMBER: "85291234567",
    NEXT_PUBLIC_CURRENCY: "HKD",
    NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-ABCDEF12",
    NEXT_PUBLIC_GSC_VERIFICATION: "token-abc",
  };
  assert.deepEqual(envDefaults(env), {
    "brand.name": "Brand",
    "brand.name_native": "品牌",
    "site.url": "https://shop.example",
    "contact.whatsapp": "85291234567",
    currency: "HKD",
    "analytics.ga_measurement_id": "G-ABCDEF12",
    "analytics.gsc_verification": "token-abc",
  });
});

test("envDefaults: unset -> null, blank -> null, values are trimmed", () => {
  assert.deepEqual(envDefaults({}), {
    "brand.name": null,
    "brand.name_native": null,
    "site.url": null,
    "contact.whatsapp": null,
    currency: null,
    "analytics.ga_measurement_id": null,
    "analytics.gsc_verification": null,
  });
  const blanks = envDefaults({
    NEXT_PUBLIC_BRAND_NAME: "",
    NEXT_PUBLIC_SITE_URL: "   ",
    NEXT_PUBLIC_CURRENCY: " HKD ",
  });
  assert.equal(blanks["brand.name"], null);
  assert.equal(blanks["site.url"], null);
  assert.equal(blanks.currency, "HKD");
});

/* ------------------------------------------------------------------ */
/* settingRowModel                                                     */
/* ------------------------------------------------------------------ */

test("rows: no overrides -> every row none, effective = env default", () => {
  const rows = settingRowModel(
    {},
    {
      NEXT_PUBLIC_BRAND_NAME: "Brand",
      NEXT_PUBLIC_SITE_URL: "https://shop.example",
      NEXT_PUBLIC_WHATSAPP_NUMBER: "85291234567",
    },
  );
  assert.deepEqual(
    rows.map((r) => r.key),
    [...SETTINGS_KEYS],
    "rows follow the display order",
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  assert.equal(byKey.get("brand.name").state, "none");
  assert.equal(byKey.get("brand.name").overrideValue, null);
  assert.equal(byKey.get("brand.name").envDefault, "Brand");
  assert.equal(byKey.get("brand.name").effective, "Brand");
  assert.equal(byKey.get("brand.name").missingRequired, false);
  assert.equal(byKey.get("contact.whatsapp").effective, "85291234567");
  // Nothing configured anywhere -> empty effective, not invented state.
  assert.equal(byKey.get("brand.name_native").effective, "");
  assert.equal(byKey.get("brand.name_native").missingRequired, false);
  // Currency has a CODE default (no OFF state).
  assert.equal(byKey.get("currency").effective, "HKD");
  assert.equal(byKey.get("currency").envDefault, null);
  // Required rows carry the no-toggle marker; optional ones do not.
  assert.equal(byKey.get("brand.name").required, true);
  assert.equal(byKey.get("site.url").required, true);
  assert.equal(byKey.get("currency").required, false);
});

test("rows: overrides incl. an OFF row (presence-wins) and an ON brand.name", () => {
  const rows = settingRowModel(
    {
      "brand.name": "OVERRIDE",
      "brand.name_native": "",
      "contact.whatsapp": "",
      currency: "EUR",
    },
    {
      NEXT_PUBLIC_BRAND_NAME: "Brand",
      NEXT_PUBLIC_BRAND_NAME_NATIVE: "品牌",
      NEXT_PUBLIC_SITE_URL: "https://shop.example",
      NEXT_PUBLIC_WHATSAPP_NUMBER: "85291234567",
      NEXT_PUBLIC_CURRENCY: "HKD",
    },
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));

  // ON: the override wins over env.
  assert.equal(byKey.get("brand.name").state, "on");
  assert.equal(byKey.get("brand.name").overrideValue, "OVERRIDE");
  assert.equal(byKey.get("brand.name").effective, "OVERRIDE");

  // OFF rows: empty override persisted, env suppressed, the OFF reality
  // renders; optional keys show the OFF display value.
  assert.equal(byKey.get("brand.name_native").state, "off");
  assert.equal(byKey.get("brand.name_native").overrideValue, "");
  assert.equal(byKey.get("brand.name_native").effective, OFF_EFFECTIVE);
  assert.equal(byKey.get("contact.whatsapp").state, "off");
  assert.equal(byKey.get("contact.whatsapp").effective, OFF_EFFECTIVE);

  // Currency ON overrides the env default.
  assert.equal(byKey.get("currency").state, "on");
  assert.equal(byKey.get("currency").effective, "EUR");

  // No override anywhere else -> env default.
  assert.equal(byKey.get("site.url").state, "none");
  assert.equal(byKey.get("site.url").effective, "https://shop.example");
});

test("rows: missing brand.name entirely (no override, no env) -> missingRequired red flag", () => {
  const rows = settingRowModel(
    { "site.url": "https://shop.example" },
    { NEXT_PUBLIC_SITE_URL: "https://shop.example" },
  );
  const brand = rows.find((r) => r.key === "brand.name");
  assert.equal(brand.state, "none");
  assert.equal(brand.effective, "");
  assert.equal(brand.missingRequired, true);
  // site.url is satisfied by its override.
  const site = rows.find((r) => r.key === "site.url");
  assert.equal(site.missingRequired, false);
  // Optional keys never get the red flag.
  assert.ok(rows.every((r) => (r.required ? true : !r.missingRequired)));
});

test("rows: site.url missing on BOTH layers -> missingRequired too", () => {
  const rows = settingRowModel({ "brand.name": "Brand" }, {});
  const site = rows.find((r) => r.key === "site.url");
  assert.equal(site.missingRequired, true);
});

test("rows: required keys are NEVER 'OFF' — a defensive empty override is MISSING (presence-wins), never the env default", () => {
  // The API 400s an empty brand.name, so this state is unreachable through
  // the console; if it ever exists in the table the page must tell the
  // truth (review finding): presence-wins means the empty override
  // SUPPRESSES the env default — the key resolves EMPTY, drives the red
  // warning, and never displays the env value as if it were effective.
  const rows = settingRowModel(
    { "brand.name": "" },
    { NEXT_PUBLIC_BRAND_NAME: "Brand" },
  );
  const brand = rows.find((r) => r.key === "brand.name");
  assert.equal(brand.state, "off");
  assert.equal(brand.effective, "", "empty override suppresses env (presence-wins)");
  assert.equal(brand.missingRequired, true, "required + resolves empty -> red warning");
});

test("rows: whitespace-only brand.name override classifies ON but resolves EMPTY -> missingRequired", () => {
  // The resolver trims (lib/config.ts layered()); the API persists
  // whitespace as-is and additionally 400s whitespace-only required values —
  // defensively, the row model must still tell the truth about resolution.
  const rows = settingRowModel(
    { "brand.name": "   " },
    { NEXT_PUBLIC_SITE_URL: "https://shop.example.com" },
  );
  const brand = rows.find((r) => r.key === "brand.name");
  assert.equal(brand.state, "on");
  assert.equal(brand.effective, "   ");
  assert.equal(brand.effective.trim(), "");
  assert.equal(brand.missingRequired, true);
});

test("rows: currency code default HKD when unset on both layers", () => {
  const rows = settingRowModel({}, {});
  const currency = rows.find((r) => r.key === "currency");
  assert.equal(currency.effective, "HKD");
  assert.equal(currency.missingRequired, false);
});

/* ------------------------------------------------------------------ */
/* relayActionSlug                                                     */
/* ------------------------------------------------------------------ */

test("relayActionSlug: 200/204 -> saved", () => {
  assert.equal(relayActionSlug(200, { key: "currency", value: "HKD" }), "saved");
  assert.equal(relayActionSlug(204, null), "saved");
});

test("relayActionSlug: 400 -> invalid, 401 -> notauthenticated", () => {
  assert.equal(
    relayActionSlug(400, { error: "currency must be three uppercase letters (ISO 4217)" }),
    "invalid",
  );
  assert.equal(relayActionSlug(401, { error: "not authenticated" }), "notauthenticated");
});

test("relayActionSlug: DELETE 404 not-found -> saved (idempotent revert)", () => {
  // LITERAL string (not the exported constant): an independent pin of the
  // Rust contract body — api/src/admin_crud.rs delete_setting answers
  // {"error":"settings override not found"}.
  assert.equal(
    relayActionSlug(404, { error: "settings override not found" }),
    "saved",
  );
});

test("relayActionSlug: any other 404 body, 5xx and status 0 -> network", () => {
  assert.equal(relayActionSlug(404, { error: "product not found" }), "network");
  assert.equal(relayActionSlug(404, null), "network");
  assert.equal(relayActionSlug(403, null), "network");
  assert.equal(relayActionSlug(503, { error: "database unavailable" }), "network");
  assert.equal(relayActionSlug(0, null), "network");
});

/* ------------------------------------------------------------------ */
/* dispatchSettingAction (shape guard; full dispatch in                */
/* test/admin-settings-relay.test.mjs)                                */
/* ------------------------------------------------------------------ */

test("dispatch: never throws and always resolves the closed slug set", async () => {
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  const result = await dispatchSettingAction(
    "http://api.test",
    "currency",
    "save",
    "HKD",
    "session-value",
    fetchImpl,
  );
  assert.equal(result.slug, "network");
  assert.equal(result.savedKey, null);
});

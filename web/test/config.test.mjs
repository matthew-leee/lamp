/*
  Unit tests for lib/config.ts (ENV-01, CONFIG-01): layered resolution
  (settings override -> env default -> safe default/codelt), the required
  brand, template rendering and the env knobs. Pure env manipulation, no
  network.
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  intEnvKnob,
  renderTemplate,
  requireApiUrl,
  resolveSiteConfig,
} from "../lib/config.ts";

const BRAND_ENV = "NEXT_PUBLIC_BRAND_NAME";
const NATIVE_ENV = "NEXT_PUBLIC_BRAND_NAME_NATIVE";
const WHATSAPP_ENV = "NEXT_PUBLIC_WHATSAPP_NUMBER";
const CURRENCY_ENV = "NEXT_PUBLIC_CURRENCY";
const SITE_URL_ENV = "NEXT_PUBLIC_SITE_URL";
const API_ENV = "NEXT_PUBLIC_API_URL";

/** Save/restore the env keys a test touches. */
function withEnv(overrides, fn) {
  const keys = [
    BRAND_ENV,
    NATIVE_ENV,
    WHATSAPP_ENV,
    CURRENCY_ENV,
    SITE_URL_ENV,
    API_ENV,
    "NEXT_PUBLIC_GA_MEASUREMENT_ID",
    "NEXT_PUBLIC_GSC_VERIFICATION",
    "NEXT_PUBLIC_AVAILABILITY_TTL_MS",
    "NEXT_PUBLIC_FETCH_TIMEOUT_MS",
    "NEXT_PUBLIC_CONTENT_REVALIDATE_SECONDS",
  ];
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("brand is required: missing brand fails loudly", () => {
  withEnv({ [BRAND_ENV]: undefined }, () => {
    assert.throws(
      () => resolveSiteConfig(null),
      /brand name is required/,
    );
  });
});

test("env layer supplies the brand and safe defaults", () => {
  withEnv({ [BRAND_ENV]: "HVILE" }, () => {
    const config = resolveSiteConfig(null);
    assert.equal(config.brandName, "HVILE");
    assert.equal(config.brandNameNative, null);
    assert.equal(config.currency, "HKD");
    assert.equal(config.siteUrl, null);
    assert.equal(config.whatsappNumber, null);
    assert.equal(config.gaMeasurementId, null);
    assert.equal(config.gscVerification, null);
  });
});

test("settings override wins over env; both win over defaults", () => {
  withEnv(
    {
      [BRAND_ENV]: "EnvBrand",
      [WHATSAPP_ENV]: "85211111111",
      [CURRENCY_ENV]: "HKD",
    },
    () => {
      const config = resolveSiteConfig({
        "brand.name": "SettingsBrand",
        currency: "USD",
      });
      assert.equal(config.brandName, "SettingsBrand");
      assert.equal(config.whatsappNumber, "85211111111"); // env layer (no override)
      assert.equal(config.currency, "USD"); // override wins
    },
  );
});

test("identical native form is treated as absent", () => {
  withEnv(
    { [BRAND_ENV]: "HVILE", [NATIVE_ENV]: "HVILE" },
    () => {
      assert.equal(resolveSiteConfig(null).brandNameNative, null);
    },
  );
});

test("distinct native form is preserved", () => {
  withEnv(
    { [BRAND_ENV]: "HVILE", [NATIVE_ENV]: "休憩" },
    () => {
      assert.equal(resolveSiteConfig(null).brandNameNative, "休憩");
    },
  );
});

test("blank values are treated as unset", () => {
  withEnv(
    { [BRAND_ENV]: "HVILE", [WHATSAPP_ENV]: "   " },
    () => {
      assert.equal(resolveSiteConfig(null).whatsappNumber, null);
    },
  );
});

test("renderTemplate replaces brand, subject and pieces; unknown vars stay", () => {
  assert.equal(
    renderTemplate("{brand} sells {subject}", { brand: "HVILE", subject: "lamps" }),
    "HVILE sells lamps",
  );
  assert.equal(renderTemplate("{brand}", { brand: "HVILE" }), "HVILE");
  // {pieces} renders the catalogue-derived count into prose.
  assert.equal(
    renderTemplate("The drop: {pieces} pieces", { brand: "HVILE", pieces: "16" }),
    "The drop: 16 pieces",
  );
  // Unknown placeholder untouched: a content typo stays visible.
  assert.equal(renderTemplate("{oops} {brand}", { brand: "HVILE" }), "{oops} HVILE");
});

test("settings presence wins: an explicit empty override turns the key OFF", () => {
  withEnv(
    {
      [BRAND_ENV]: "HVILE",
      [WHATSAPP_ENV]: "85211111111",
      NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-XXXXXXX",
    },
    () => {
      // An empty override is PRESENCE, not absence: GA goes OFF (GA-OFF-01)
      // and the WhatsApp number is hidden, despite both being set in env.
      const config = resolveSiteConfig({
        "analytics.ga_measurement_id": "",
        "contact.whatsapp": "",
      });
      assert.equal(config.gaMeasurementId, null);
      assert.equal(config.whatsappNumber, null);
      // A key absent from the override falls through to env as before.
      assert.equal(config.brandName, "HVILE");
    },
  );
});

test("intEnvKnob: unset/blank/invalid fall back to the default", () => {
  withEnv(
    { NEXT_PUBLIC_AVAILABILITY_TTL_MS: undefined },
    () => assert.equal(intEnvKnob("NEXT_PUBLIC_AVAILABILITY_TTL_MS", 60_000, 1, 600_000), 60_000),
  );
  withEnv(
    { NEXT_PUBLIC_AVAILABILITY_TTL_MS: "  " },
    () => assert.equal(intEnvKnob("NEXT_PUBLIC_AVAILABILITY_TTL_MS", 60_000, 1, 600_000), 60_000),
  );
  withEnv(
    { NEXT_PUBLIC_AVAILABILITY_TTL_MS: "not-a-number" },
    () => assert.equal(intEnvKnob("NEXT_PUBLIC_AVAILABILITY_TTL_MS", 60_000, 1, 600_000), 60_000),
  );
});

test("intEnvKnob: valid values pass through and out-of-range clamps", () => {
  withEnv({ NEXT_PUBLIC_AVAILABILITY_TTL_MS: "30000" }, () =>
    assert.equal(intEnvKnob("NEXT_PUBLIC_AVAILABILITY_TTL_MS", 60_000, 1_000, 60_000), 30_000));
  // The TTL knob is capped AT the commitment 5b bound (60s): a larger value
  // clamps down, never up.
  withEnv({ NEXT_PUBLIC_AVAILABILITY_TTL_MS: "120000" }, () =>
    assert.equal(intEnvKnob("NEXT_PUBLIC_AVAILABILITY_TTL_MS", 60_000, 1_000, 60_000), 60_000));
  withEnv({ NEXT_PUBLIC_AVAILABILITY_TTL_MS: "0" }, () =>
    assert.equal(intEnvKnob("NEXT_PUBLIC_AVAILABILITY_TTL_MS", 60_000, 1_000, 60_000), 1_000));
  // The content revalidation window is capped at the same 60s bound.
  withEnv({ NEXT_PUBLIC_CONTENT_REVALIDATE_SECONDS: "600" }, () =>
    assert.equal(intEnvKnob("NEXT_PUBLIC_CONTENT_REVALIDATE_SECONDS", 60, 1, 60), 60));
});

test("requireApiUrl: missing fails loudly, value is trimmed", () => {
  withEnv({ [API_ENV]: undefined }, () =>
    assert.throws(() => requireApiUrl(), /NEXT_PUBLIC_API_URL is required/));
  withEnv({ [API_ENV]: "  http://localhost:8080  " }, () =>
    assert.equal(requireApiUrl(), "http://localhost:8080"));
});

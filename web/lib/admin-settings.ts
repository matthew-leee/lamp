/**
 * Settings model for the D2b admin settings page (ADMIN-01, SCOPE-01): the
 * PURE half — metadata, presence-wins classification, row models and the
 * mutation dispatch. No `next/*` imports; the env is INJECTED so every
 * mapping is unit-testable without a server
 * (test/admin-settings.test.mjs, test/admin-settings-relay.test.mjs).
 *
 * THE FOUNDER TOGGLE SPEC (non-negotiable, Vision.md): every settings field
 * renders a toggle. ON -> the value saves; OFF -> the field greys out and
 * the key persists EMPTY; deleting the override reverts to the env default.
 * No-toggle fields: `brand.name` and `site.url` (REQUIRED — the resolver
 * throws when the brand name is empty; they render NO toggle and a RED
 * warning when empty). `currency` has NO OFF state (always resolves, code
 * default HKD, ISO-validated by the API). Optional toggles:
 * `brand.name_native`, `contact.whatsapp`, `analytics.ga_measurement_id`,
 * `analytics.gsc_verification`. SCOPE-01: these COMPANY keys only.
 *
 * PRESENCE-WINS (CONFIG-01): the KEY's presence decides, not the value's
 * truthiness. A PRESENT override with an empty value is the explicit OFF
 * state (it must beat the env layer — otherwise an override could never
 * turn anything off); a present non-empty value is ON; an ABSENT key is
 * "no override" and the env default applies. Classification is exact:
 * `value === ""` is OFF, anything else (whitespace included — the API
 * persists it as-is) is ON; the RESOLVER (lib/config.ts layered()) trims,
 * so a whitespace-only override classifies ON here but resolves as absent
 * (documented edge; the API additionally rejects whitespace-only for the
 * required keys).
 *
 * WHY THE PAGE READS `GET /api/settings` (public): that endpoint is the
 * flat whitelist-only override map and INCLUDES EMPTY values (verified in
 * api/src/content.rs get_settings / filter_public_settings — no emptiness
 * filter), which is exactly what the toggle state needs: an empty override
 * visible there = explicitly OFF, an absent key = reverted to env. A
 * filtered (non-empty-only) read could not distinguish OFF from reverted.
 * Mutations go through the web RELAY (`app/admin/api/settings/[key]` -> this
 * module's `dispatchSettingAction` -> `PUT/DELETE /api/admin/settings/{key}`
 * with the session cookie + X-Requested-With), never browser -> API
 * (see lib/admin-client.ts for the relay architecture).
 *
 * D2a contract pins (api/src/admin_crud.rs, read at implementation time):
 * - `PUT /api/admin/settings/{key}` body `{"value": string}`; 400s for
 *   unknown/secret-looking keys ("settings key not admin-editable"),
 *   empty `brand.name`/`site.url`, non-ISO `currency`, NUL bytes; an empty
 *   value on an OPTIONAL key is the explicit OFF state (upserts the empty
 *   row). PUT never 404s (it upserts).
 * - `DELETE /api/admin/settings/{key}` needs NO body (the handler extracts
 *   none) and 404s with `{"error": "settings override not found"}` when no
 *   row exists — which the relay maps to SAVED (idempotent revert: the key
 *   is already at its env default).
 */

import {
  adminMutate,
  type AdminApiResponse,
  type FetchLike,
} from "./admin-client.ts";
import type { SettingsOverrides } from "./config.ts";

/* ------------------------------------------------------------------ */
/* Key sets and display metadata                                       */
/* ------------------------------------------------------------------ */

/**
 * The public settings keys (mirror of the API whitelist,
 * api/src/content.rs `PUBLIC_SETTING_KEYS`) in the DELIBERATE DISPLAY
 * ORDER of the admin page: identity first, then site/contact, then money,
 * then analytics. The order is a UI decision, not the API's (which sorts
 * by key).
 */
export const SETTINGS_KEYS = [
  "brand.name",
  "brand.name_native",
  "site.url",
  "contact.whatsapp",
  "currency",
  "analytics.ga_measurement_id",
  "analytics.gsc_verification",
] as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[number];

/**
 * Required keys: NO toggle (no OFF button ever rendered), never empty —
 * the API 400s an empty value and lib/config.ts resolveSiteConfig throws
 * for a missing brand name. When override AND env are both empty the row
 * gets `missingRequired` and the page renders the RED warning.
 */
export const REQUIRED_KEYS = ["brand.name", "site.url"] as const;

/** The key with NO OFF state (always resolves; code default HKD). */
export const CURRENCY_KEY = "currency";

/** The OFF display value for optional keys (exact string, page renders it). */
export const OFF_EFFECTIVE = "OFF (explicitly)";

/** Code-level defaults where a safe one exists (override -> env -> code). */
const CODE_DEFAULTS: Partial<Record<SettingsKey, string>> = {
  currency: "HKD",
};

/**
 * NEXT_PUBLIC_* env var per key — the SAME env defaults lib/config.ts
 * resolves (override -> env -> code default), read RAW here (no GA shape
 * validation, no native-form collapse: this layer only displays what the
 * deployment configured).
 */
const ENV_VARS: Record<SettingsKey, string> = {
  "brand.name": "NEXT_PUBLIC_BRAND_NAME",
  "brand.name_native": "NEXT_PUBLIC_BRAND_NAME_NATIVE",
  "site.url": "NEXT_PUBLIC_SITE_URL",
  "contact.whatsapp": "NEXT_PUBLIC_WHATSAPP_NUMBER",
  currency: "NEXT_PUBLIC_CURRENCY",
  "analytics.ga_measurement_id": "NEXT_PUBLIC_GA_MEASUREMENT_ID",
  "analytics.gsc_verification": "NEXT_PUBLIC_GSC_VERIFICATION",
};

/** Per-key display metadata (English-only admin; see app/admin/layout.tsx). */
export interface SettingMeta {
  label: string;
  hint: string;
}

const META: Record<SettingsKey, SettingMeta> = {
  "brand.name": {
    label: "Brand name (Latin script)",
    hint: "wordmark and meta titles; required",
  },
  "brand.name_native": {
    label: "Brand name (native script)",
    hint: "optional native-script display form",
  },
  "site.url": {
    label: "Site URL",
    hint: "absolute URL, no trailing slash",
  },
  "contact.whatsapp": {
    label: "WhatsApp number",
    hint: "international digits, e.g. 85291234567",
  },
  currency: {
    label: "Currency",
    hint: "ISO 4217 code, e.g. HKD",
  },
  "analytics.ga_measurement_id": {
    label: "Google Analytics 4 ID",
    hint: "GA4 id, e.g. G-XXXXXXXXXX",
  },
  "analytics.gsc_verification": {
    label: "Search Console verification",
    hint: "Google Search Console verification token",
  },
};

/** The display metadata for one key (label + input hint). */
export function settingMeta(key: SettingsKey): SettingMeta {
  return META[key];
}

/** True when `value` is one of the closed set of public settings keys. */
export function isSettingsKey(value: string): value is SettingsKey {
  return (SETTINGS_KEYS as readonly string[]).includes(value);
}

/** True for the no-toggle required keys. */
export function isRequiredKey(key: SettingsKey): boolean {
  return (REQUIRED_KEYS as readonly string[]).includes(key);
}

/* ------------------------------------------------------------------ */
/* Env defaults (pure, env injected)                                   */
/* ------------------------------------------------------------------ */

/** Minimal env shape for injection (subset of process.env). */
export type EnvLike = Record<string, string | undefined>;

/**
 * The RAW env default per key: the mapped `NEXT_PUBLIC_*` value, trimmed
 * (blank/unset -> null = "not provided by env" — the same reading
 * lib/config.ts layered() uses). No validation here: a typo'd GA id or
 * odd currency is still the deployment's configured default and the page
 * shows it as such; the API validates what gets SAVED.
 */
export function envDefaults(
  env: EnvLike,
): Record<SettingsKey, string | null> {
  const out = {} as Record<SettingsKey, string | null>;
  for (const key of SETTINGS_KEYS) {
    const raw = env[ENV_VARS[key]]?.trim();
    out[key] = raw === undefined || raw === "" ? null : raw;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Presence-wins classification (pure)                                 */
/* ------------------------------------------------------------------ */

/** Toggle state of one key, decided by PRESENCE (CONFIG-01). */
export type SettingState =
  | { state: "none" }
  | { state: "on"; value: string }
  | { state: "off" };

/**
 * Classify one key against the override map, presence-wins:
 * - key ABSENT            -> { state: "none" }  (revert: env default applies)
 * - key PRESENT, value "" -> { state: "off" }   (explicitly OFF, persisted)
 * - key PRESENT, else     -> { state: "on", value } (whitespace-only is ON;
 *                          the API persists it as-is — see the module note)
 */
export function classifySetting(
  overrides: SettingsOverrides,
  key: string,
): SettingState {
  if (overrides === null || overrides === undefined || !(key in overrides)) {
    return { state: "none" };
  }
  const value = overrides[key] ?? "";
  return value === "" ? { state: "off" } : { state: "on", value };
}

/* ------------------------------------------------------------------ */
/* Row models (pure)                                                   */
/* ------------------------------------------------------------------ */

/** One rendered settings row (the page turns this into one plain form). */
export interface SettingRowModel {
  key: SettingsKey;
  label: string;
  hint: string;
  /** No-toggle required key (no OFF button, red warning when empty). */
  required: boolean;
  state: SettingState["state"];
  /** The persisted override value; "" when explicitly OFF; null when none. */
  overrideValue: string | null;
  /** The raw env default (null = unset). */
  envDefault: string | null;
  /** Display string for the CURRENT effective value (see mapping below). */
  effective: string;
  /** Required key with NO override and NO env default (red warning). */
  missingRequired: boolean;
}

/**
 * Build the row models in display order.
 *
 * `effective` mapping (founder spec):
 * - "on"  -> the override value;
 * - "off" -> {@link OFF_EFFECTIVE} for optional keys. Required keys are
 *   NEVER off (the API 400s an empty value for them), so a defensive empty
 *   override on a required key displays as its env default instead;
 * - "none" -> env default, else the code default where one exists
 *   (`currency` -> "HKD"), else "" (nothing configured).
 *
 * `missingRequired` marks a required key whose override AND env default are
 * both empty (after trim) — the page renders the red warning for it and the
 * storefront would fail to resolve (resolveSiteConfig throws for the brand
 * name).
 */
export function settingRowModel(
  overrides: SettingsOverrides,
  env: EnvLike,
): SettingRowModel[] {
  const defaults = envDefaults(env);
  return SETTINGS_KEYS.map((key) => {
    const { label, hint } = META[key];
    const required = isRequiredKey(key);
    const envDefault = defaults[key];
    const classified = classifySetting(overrides, key);

    let overrideValue: string | null = null;
    let effective: string;
    if (classified.state === "on") {
      overrideValue = classified.value;
      effective = classified.value;
    } else if (classified.state === "off") {
      overrideValue = "";
      // PRESENCE-WINS truth (review finding): the resolver (lib/config.ts
      // layered()) does NOT fall back to env for a PRESENT key — an empty
      // override SUPPRESSES the env default, exactly like the optional keys'
      // explicit OFF (which displays OFF_EFFECTIVE). Required keys are
      // never OFFERED an empty save (the API 400s it; the page renders no
      // OFF button), but a defensively present empty row must display as
      // what it is: MISSING (empty effective, missingRequired, red
      // warning) — never the env default.
      effective = required ? "" : OFF_EFFECTIVE;
    } else {
      effective = envDefault ?? CODE_DEFAULTS[key] ?? "";
    }

    return {
      key,
      label,
      hint,
      required,
      state: classified.state,
      overrideValue,
      envDefault,
      effective,
      // Presence-wins for required keys too: empty override (effective
      // "" after the fix above) OR missing env default = missing.
      missingRequired: required && effective.trim() === "",
    };
  });
}

/* ------------------------------------------------------------------ */
/* Mutation dispatch (pure logic, injectable fetch)                    */
/* ------------------------------------------------------------------ */

/** The form actions one settings row can POST (the relay's dispatch). */
export type SettingAction = "save" | "off" | "revert";

/** Redirect slugs the relay may emit (the page maps them to messages). */
export type RelayActionSlug =
  | "saved"
  | "invalid"
  | "notauthenticated"
  | "network";

/**
 * The DELETE 404 body of the settings API (pinned contract string, same
 * style as admin-client.ts): "the override row does not exist" = already at
 * the env default, which is what a revert WANTS — an idempotent success.
 */
export const SETTING_OVERRIDE_NOT_FOUND = "settings override not found";

/** Extract the API's `{"error": "<string>"}` body, or null. */
function errorFromBody(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const error = (json as Record<string, unknown>).error;
  return typeof error === "string" && error !== "" ? error : null;
}

/**
 * Map one API mutation result to the relay's redirect slug:
 * - 200/204 -> "saved";
 * - 400     -> "invalid" (the API actually judged the value);
 * - 401     -> "notauthenticated";
 * - 404 with the DELETE not-found body -> "saved" (idempotent revert: the
 *   override is already gone / never existed, the key is at its env
 *   default — `json` disambiguates it from an unexpected 404 of any other
 *   shape; PUT upserts and never 404s);
 * - anything else, including status 0 (network/abort) -> "network" (retry
 *   guidance: never claim a save or a verdict when nothing was judged).
 */
export function relayActionSlug(status: number, json: unknown): RelayActionSlug {
  if (status === 200 || status === 204) return "saved";
  if (status === 400) return "invalid";
  if (status === 401) return "notauthenticated";
  if (status === 404 && errorFromBody(json) === SETTING_OVERRIDE_NOT_FOUND) {
    return "saved";
  }
  return "network";
}

/** Outcome of one settings dispatch: slug + the key that was saved (if any). */
export interface DispatchSettingResult {
  slug: RelayActionSlug;
  /** The key when `slug` is "saved" (the relay puts it in `?saved=`), else null. */
  savedKey: string | null;
}

/**
 * Dispatch one settings form action against the Rust API (the relay's
 * whole mutation body): `adminMutate` forwards the session cookie and adds
 * the X-Requested-With CSRF header (lib/admin-client.ts), so the API's
 * XRW/CSRF contract stays untouched and the browser never talks to the
 * API. Never throws (the client's `{status, json}` contract).
 *
 * Dispatch (D2a endpoints, api/src/admin_crud.rs):
 * - "save"  -> `PUT /api/admin/settings/{key}` `{"value": value}`;
 * - "off"   -> the same PUT with `{"value": ""}` — the explicit OFF state.
 *   Only reachable for OPTIONAL keys (the page never renders the button for
 *   required keys, and the API would 400 an empty required value anyway —
 *   that maps to "invalid", which is honest);
 * - "revert"-> `DELETE /api/admin/settings/{key}`. NO body is needed: the
 *   D2a delete handler extracts none (a body would be ignored);
 *   adminMutate always sends a JSON body, so the inert `{}` goes along.
 *
 * The key is URL-PATH-encoded (`encodeURIComponent`); the API whitelists
 * the closed key set, so a smuggled key dies there with 400 "invalid".
 */
export async function dispatchSettingAction(
  apiUrl: string,
  key: string,
  action: SettingAction,
  value: string,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchSettingResult> {
  const path = `/api/admin/settings/${encodeURIComponent(key)}`;
  let result: AdminApiResponse;
  if (action === "revert") {
    result = await adminMutate(apiUrl, path, "DELETE", sessionValue, {}, fetchImpl);
  } else {
    result = await adminMutate(
      apiUrl,
      path,
      "PUT",
      sessionValue,
      { value: action === "off" ? "" : value },
      fetchImpl,
    );
  }
  const slug = relayActionSlug(result.status, result.json);
  return { slug, savedKey: slug === "saved" ? key : null };
}

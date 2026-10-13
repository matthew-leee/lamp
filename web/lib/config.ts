/**
 * Runtime configuration resolution (ENV-01, CONFIG-01).
 *
 * Two layers, resolved in this order:
 * 1. **Settings overrides** — rows of the `settings` table (API
 *    `GET /api/settings`), admin-editable in the D2 console. Only non-secret
 *    keys are ever readable there (the API enforces a whitelist).
 * 2. **Environment defaults** — `NEXT_PUBLIC_*` values from `.env.local` /
 *    the deployment environment, documented in `.env.example`.
 *
 * There is no third "company literal" layer: nothing company-specific is
 * hardcoded inline anywhere. Resolution is pure (no fetch here): the caller
 * passes the overrides it fetched, so this module is unit-testable and usable
 * both at build time (static generation) and at request time.
 *
 * Secrets (`DATABASE_URL`, gateway/session keys) never appear here: they are
 * server-env only and are not part of the site config surface.
 */

/** Raw settings overrides as served by `GET /api/settings` (already whitelisted). */
export type SettingsOverrides = Record<string, string> | null | undefined;

/** The resolved site configuration the storefront renders with. */
export interface SiteConfig {
  /** Brand name in Latin script (wordmark, meta titles, {brand} in copy). */
  brandName: string;
  /** Native-script brand display form when it differs; null = use brandName. */
  brandNameNative: string | null;
  /** Canonical public site URL, no trailing slash (canonical/hreflang/sitemap). */
  siteUrl: string | null;
  /** WhatsApp number, international digits only; null = no confirmed channel. */
  whatsappNumber: string | null;
  /** GA4 measurement ID; null = GA off (GA-OFF-01; C8 gates turning it on). */
  gaMeasurementId: string | null;
  /** Search Console verification token; null = omit the meta tag. */
  gscVerification: string | null;
  /** ISO 4217 currency code driving the money formatter. */
  currency: string;
}

/** Settings keys (the API whitelist maps them 1:1 to these fields). */
const KEYS = {
  brandName: "brand.name",
  brandNameNative: "brand.name_native",
  siteUrl: "site.url",
  whatsappNumber: "contact.whatsapp",
  gaMeasurementId: "analytics.ga_measurement_id",
  gscVerification: "analytics.gsc_verification",
  currency: "currency",
} as const;

/** Read one override -> env layer, with EXPLICIT-EMPTY override semantics
 * (CONFIG-01): a key PRESENT in the settings map wins, and its empty value
 * means "explicitly off/absent" — e.g. an empty analytics.ga_measurement_id
 * override disables a GA id set in env, and an empty contact.whatsapp
 * override hides a number set in env. Without this, an override could never
 * turn anything off and the env layer would stick forever. Blank/unset env
 * values mean "not provided" as before.
 */
function layered(
  overrides: SettingsOverrides,
  envName: string,
  settingsKey: string,
): string | null {
  if (overrides !== null && overrides !== undefined && settingsKey in overrides) {
    const fromSettings = overrides[settingsKey]?.trim();
    return fromSettings === undefined || fromSettings === "" ? null : fromSettings;
  }
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return fromEnv;
  return null;
}

/**
 * Resolve the full site config.
 *
 * Brand name is required (white-label test: swap the env values and another
 * company runs): missing brand fails loudly with an actionable message rather
 * than rendering a nameless site. Everything else has a safe default or an
 * explicit null meaning "absent by design".
 */
export function resolveSiteConfig(overrides: SettingsOverrides): SiteConfig {
  const brandName = layered(
    overrides,
    "NEXT_PUBLIC_BRAND_NAME",
    KEYS.brandName,
  );
  if (brandName === null) {
    throw new Error(
      "resolveSiteConfig: brand name is required. Set NEXT_PUBLIC_BRAND_NAME " +
        "(or a brand.name settings override) to the site brand.",
    );
  }

  let brandNameNative = layered(
    overrides,
    "NEXT_PUBLIC_BRAND_NAME_NATIVE",
    KEYS.brandNameNative,
  );
  if (brandNameNative === brandName) {
    // An identical native form adds nothing; treat it as absent.
    brandNameNative = null;
  }

  return {
    brandName,
    brandNameNative,
    siteUrl: layered(overrides, "NEXT_PUBLIC_SITE_URL", KEYS.siteUrl),
    whatsappNumber: layered(
      overrides,
      "NEXT_PUBLIC_WHATSAPP_NUMBER",
      KEYS.whatsappNumber,
    ),
    gaMeasurementId: layered(
      overrides,
      "NEXT_PUBLIC_GA_MEASUREMENT_ID",
      KEYS.gaMeasurementId,
    ),
    gscVerification: layered(
      overrides,
      "NEXT_PUBLIC_GSC_VERIFICATION",
      KEYS.gscVerification,
    ),
    currency: layered(overrides, "NEXT_PUBLIC_CURRENCY", KEYS.currency) ?? "HKD",
  };
}

/**
 * Render a `{placeholder}` template from site content. Supported vars:
 * `{brand}`, `{subject}` and `{pieces}` (the catalogue-derived drop size, so
 * prose that names a count stays count-authoritative). Unknown placeholders
 * are left verbatim so a content typo is visible instead of silently
 * swallowed.
 */
export function renderTemplate(
  template: string,
  vars: { brand: string; subject?: string; pieces?: string },
): string {
  let out = template.split("{brand}").join(vars.brand);
  if (vars.subject !== undefined) {
    out = out.split("{subject}").join(vars.subject);
  }
  if (vars.pieces !== undefined) {
    out = out.split("{pieces}").join(vars.pieces);
  }
  return out;
}

/**
 * Read an integer env knob with a safe default and bounds. Returns the
 * default when unset, blank or unparseable; clamps into [min, max].
 * Operational knobs (ENV-01) are tunable per deployment, never inline.
 */
export function intEnvKnob(
  name: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * The Rust API base URL (env-only infrastructure config: it is where the
 * site reads its data, not company-visible configuration). Required for
 * build-time data fetching; missing means the build cannot generate pages.
 */
export function requireApiUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!base) {
    throw new Error(
      "requireApiUrl: NEXT_PUBLIC_API_URL is required (the base URL of the " +
        "Rust API serving the catalogue).",
    );
  }
  return base;
}

/**
 * How long a confirmed stock number may be displayed, ms. Default 60_000
 * (the commitment 5b bound), tunable DOWN only: 1_000..60_000. A longer TTL
 * would exceed the 5b freshness bound, so 60s is the cap, not just the
 * default.
 */
export function availabilityTtlMs(): number {
  return intEnvKnob("NEXT_PUBLIC_AVAILABILITY_TTL_MS", 60_000, 1_000, 60_000);
}

/**
 * Abort timeout for one availability fetch, ms (default 10s, bounds
 * 100..120_000).
 */
export function fetchTimeoutMs(): number {
  return intEnvKnob("NEXT_PUBLIC_FETCH_TIMEOUT_MS", 10_000, 100, 120_000);
}

/**
 * Revalidation window for cached content fetches (catalogue, site copy,
 * settings), SECONDS. Default 60 (the commitment 5b stale bound), tunable
 * DOWN only: 1..60. ISR serves stale-while-revalidate, so this bounds the
 * data-cache age; on-demand purge via the tags (D2 admin) is the mutation
 * path, and a larger window would exceed the 5b bound.
 */
export function contentRevalidateSeconds(): number {
  return intEnvKnob("NEXT_PUBLIC_CONTENT_REVALIDATE_SECONDS", 60, 1, 60);
}

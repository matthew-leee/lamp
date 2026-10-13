/**
 * Build-time catalogue and site data client (DATA-02, CONFIG-01).
 *
 * This is the OPPOSITE contract from lib/availability.ts. Availability is
 * fail-closed (a page must never display a stock count it cannot confirm, so
 * failures return null). Catalogue and site copy are the page CONTENT: a page
 * that cannot be generated must not be served half-rendered or with invented
 * data, so this module FAILS LOUDLY — a thrown error fails `next build` with
 * a precise message instead of shipping a page it could not confirm.
 *
 * Sources (the Rust API is the only reader of Postgres):
 *   GET /api/catalogue     -> Catalogue (products, content, ref prices, pieces)
 *   GET /api/site-content  -> SiteContent (key -> locale -> value)
 *   GET /api/settings      -> SettingsOverrides (whitelisted non-secret keys)
 *
 * The fetch is injectable so every mapping and failure mode is unit-testable
 * without a network (test/catalog-client.test.mjs), mirroring the pattern of
 * lib/availability.ts. Timeouts share the configured fetch knob
 * (lib/config.ts fetchTimeoutMs).
 *
 * Freshness model (commitment 5b): these fetches use Next's revalidating
 * data cache (`next.revalidate: 60` + tags), NOT `no-store`. A no-store fetch
 * makes a route dynamic and un-prerenderable; the catalogue is baked into
 * static pages, with a cached fallback stale by at most 60 seconds and
 * on-demand purges via the tags (the D2 admin console calls revalidateTag
 * on its mutations). Live STOCK keeps the separate no-store fail-closed
 * channel (lib/availability.ts) and never passes through here.
 */

import { contentRevalidateSeconds, fetchTimeoutMs } from "./config.ts";
import { isRustBlank } from "./rust-text.ts";

/* ------------------------------------------------------------------ */
/* Types (mirroring the API DTOs, snake_case -> camelCase)             */
/* ------------------------------------------------------------------ */

/** Per-locale product copy; fields present only when the DB row exists. */
export interface ProductContent {
  /** Locale-script display name; the Latin name lives on the product row. */
  modelAlt?: string;
  colourway?: string;
  heritage?: string;
  electrical?: string;
}

/** Placeholder art configuration (product data, not a UI heuristic). */
export interface ArtConfig {
  variant: "dome" | "shades";
  hue: number;
}

/** Labelled reference price; null = no verified reference (UI says pending). */
export interface ReferencePrice {
  minPriceCents: number;
  maxPriceCents: number;
  sourceName: string;
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) the source was last checked. */
  checkedOn: string;
}

/** One active SKU of the catalogue (no stock fields: stock is /api/products). */
export interface CatalogueProduct {
  slug: string;
  brand: string;
  /** Latin model name (en display name; other locales use content.modelAlt). */
  model: string;
  priceCents: number;
  family: string;
  art: ArtConfig;
  /** locale -> copy fields. */
  content: Record<string, ProductContent>;
  referencePrice: ReferencePrice | null;
  /** This SKU's piece numbers in the numbered drop, ascending. */
  pieces: number[];
  /** How many pieces of the drop belong to this SKU (derived COUNT). */
  unitsInDrop: number;
}

/** The active catalogue. `totalPieces` is the drop size (derived COUNT). */
export interface Catalogue {
  totalPieces: number;
  products: CatalogueProduct[];
}

/** Site copy: key -> locale -> value. */
export type SiteContent = Record<string, Record<string, string>>;

/** Fetch-like function (injectable for tests). */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

/** One typed JSON GET with the shared abort timeout and a revalidate tag. */
async function getJson(
  base: string,
  path: string,
  tag: string,
  fetchImpl: FetchLike,
): Promise<unknown> {
  const url = `${base.replace(/\/+$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs());
  try {
    // Next's fetch extends the standard init with `next` caching options.
    const init: RequestInit & { next: { revalidate: number; tags: string[] } } = {
      next: { revalidate: contentRevalidateSeconds(), tags: [tag] },
      signal: controller.signal,
    };
    const response = await fetchImpl(url, init);
    if (response.status !== 200) {
      throw new Error(
        `catalog-client: GET ${url} returned HTTP ${response.status} ` +
          `(expected 200; is the Rust API up with DATABASE_URL set?).`,
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("catalog-client:")) {
      throw error;
    }
    throw new Error(
      `catalog-client: GET ${url} failed (${String(error)}). ` +
        "The build requires a reachable API serving the seeded catalogue.",
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fail-loud assertion helper: every field must be present and well-typed;
 * the type predicate does the narrowing.
 */
function required<T>(
  value: unknown,
  what: string,
  check: (v: unknown) => v is T,
): T {
  if (!check(value)) {
    throw new Error(`catalog-client: malformed ${what}`);
  }
  return value;
}

const isString = (v: unknown): v is string =>
  typeof v === "string" && !isRustBlank(v);
/** Any string incl. blank: the D2a write contract allows an empty `family`
 * (NUL-check only, api/src/admin_crud.rs) — the catalogue parser must match
 * the writer's contract or a legal admin write blanks the storefront
 * (review finding: a blank-family active product used to throw HERE and
 * take the whole catalogue down). brand/model/slug stay strict: the API
 * rejects blank values for those, so a blank there IS malformed. */
const isLooseString = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Map one API product row (unknown) to a CatalogueProduct, or throw. */
function parseProduct(row: unknown): CatalogueProduct {
  if (typeof row !== "object" || row === null) {
    throw new Error("catalog-client: catalogue product row is not an object");
  }
  const r = row as Record<string, unknown>;

  const rawContent = r.content;
  const content: Record<string, ProductContent> = {};
  if (typeof rawContent === "object" && rawContent !== null) {
    for (const [locale, fields] of Object.entries(rawContent)) {
      if (typeof fields !== "object" || fields === null) continue;
      const f = fields as Record<string, unknown>;
      const entry: ProductContent = {};
      if (isString(f.model_alt)) entry.modelAlt = f.model_alt;
      else if (typeof f.model_alt === "string") {
        throw new Error(
          `catalog-client: blank model_alt for locale "${locale}" (product_content row is present but empty)`,
        );
      }
      if (isString(f.colourway)) entry.colourway = f.colourway;
      else if (typeof f.colourway === "string") {
        throw new Error(
          `catalog-client: blank colourway for locale "${locale}" (product_content row is present but empty)`,
        );
      }
      if (isString(f.heritage)) entry.heritage = f.heritage;
      if (isString(f.electrical)) entry.electrical = f.electrical;
      content[locale] = entry;
    }
  }

  let referencePrice: ReferencePrice | null = null;
  if (r.reference_price !== null && r.reference_price !== undefined) {
    const ref = r.reference_price;
    if (typeof ref !== "object" || ref === null) {
      throw new Error("catalog-client: malformed reference_price");
    }
    const f = ref as Record<string, unknown>;
    referencePrice = {
      minPriceCents: required(f.min_price_cents, "reference min_price_cents", isInt),
      maxPriceCents: required(f.max_price_cents, "reference max_price_cents", isInt),
      sourceName: required(f.source_name, "reference source_name", isString),
      sourceUrl: required(f.source_url, "reference source_url", isString),
      checkedOn: required(f.checked_on, "reference checked_on", isString),
    };
  }

  const rawPieces = r.pieces;
  if (!Array.isArray(rawPieces) || rawPieces.some((p) => !isInt(p))) {
    throw new Error("catalog-client: malformed pieces");
  }

  const artVariant = r.art_variant;
  if (artVariant !== "dome" && artVariant !== "shades") {
    throw new Error("catalog-client: art_variant must be dome or shades");
  }

  return {
    slug: required(r.slug, "product slug", isString),
    brand: required(r.brand, "product brand", isString),
    model: required(r.model, "product model", isString),
    priceCents: required(r.price_cents, "product price_cents", isInt),
    family: required(r.family, "product family", isLooseString),
    art: {
      variant: artVariant,
      hue: required(r.art_hue, "product art_hue", isInt),
    },
    content,
    referencePrice,
    pieces: (rawPieces as number[]).slice().sort((a, b) => a - b),
    unitsInDrop: required(r.units_in_drop, "product units_in_drop", isInt),
  };
}

/**
 * Parse a GET /api/catalogue response into a Catalogue (throws on any
 * malformed response — the fail-loud storefront contract). Exported so the
 * D2b admin product detail reads through the SAME parser as the storefront
 * (parser parity by construction, review finding: a hand-rolled admin-side
 * parser drifted — lenient where the storefront is strict and vice versa).
 */
export function parseCatalogue(
  body: unknown,
  options: { allowEmpty?: boolean } = {},
): Catalogue {
  if (typeof body !== "object" || body === null || !Array.isArray((body as Record<string, unknown>).products)) {
    throw new Error("catalog-client: catalogue response has no products array");
  }
  const b = body as Record<string, unknown>;
  const products = (b.products as unknown[]).map(parseProduct);
  const totalPieces = required(b.total_pieces, "catalogue total_pieces", isInt);
  if (products.length === 0 && options.allowEmpty !== true) {
    // The STOREFRONT build requires at least one active product (a shop with
    // nothing to sell fails loudly). The ADMIN reader instead passes
    // allowEmpty — an all-inactive catalogue is a legitimate state there:
    // without this, deactivating the last active product LOCKS the admin
    // out of the detail pages (no Activate form could ever render, review
    // finding). Structural validity is still enforced either way.
    throw new Error(
      "catalog-client: catalogue is empty (no active products); " +
        "run the migrations and the seed before building.",
    );
  }
  return { totalPieces, products };
}

/** GET /api/catalogue -> Catalogue (throws on any malformed response). */
export async function fetchCatalogue(
  apiUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<Catalogue> {
  const body = await getJson(apiUrl, "/api/catalogue", "catalogue", fetchImpl);
  return parseCatalogue(body);
}

/** GET /api/site-content -> SiteContent (key -> locale -> value). */
export async function fetchSiteContent(
  apiUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<SiteContent> {
  const body = await getJson(
    apiUrl,
    "/api/site-content",
    "site-content",
    fetchImpl,
  );
  if (typeof body !== "object" || body === null) {
    throw new Error("catalog-client: site-content response is not an object");
  }
  const raw = (body as Record<string, unknown>).content;
  if (typeof raw !== "object" || raw === null) {
    throw new Error("catalog-client: site-content response has no content map");
  }
  const out: SiteContent = {};
  for (const [key, locales] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof locales !== "object" || locales === null) continue;
    const entry: Record<string, string> = {};
    for (const [locale, value] of Object.entries(locales as Record<string, unknown>)) {
      if (typeof value === "string") entry[locale] = value;
    }
    out[key] = entry;
  }
  return out;
}

/** GET /api/settings -> whitelisted settings overrides (flat key -> value). */
export async function fetchSettings(
  apiUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, string>> {
  const body = await getJson(apiUrl, "/api/settings", "settings", fetchImpl);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("catalog-client: settings response is not a flat object");
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/** Look up a SKU by slug, or undefined when it is not in the catalogue. */
export function getProduct(
  catalogue: Catalogue,
  slug: string,
): CatalogueProduct | undefined {
  return catalogue.products.find((product) => product.slug === slug);
}

/**
 * Read one site-content value for a locale, rendered with template vars.
 * Fail-loud on a missing key/locale AND on blank/whitespace-only copy: blank
 * trust copy would render empty passages while the build still succeeds,
 * which is exactly the fail-loud contract this module exists to enforce.
 */
export function contentValue(
  content: SiteContent,
  key: string,
  locale: string,
): string {
  const entry = content[key]?.[locale];
  if (entry === undefined) {
    throw new Error(
      `catalog-client: site content key "${key}" has no value for locale "${locale}" ` +
        "(run the seed, or complete the content row).",
    );
  }
  if (isRustBlank(entry)) {
    throw new Error(
      `catalog-client: site content key "${key}" for locale "${locale}" is blank ` +
        "(present but empty rows are not renderable copy).",
    );
  }
  return entry;
}

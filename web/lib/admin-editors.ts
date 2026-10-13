/**
 * Editor data layer for the D2b task-4 admin editors (ADMIN-01): the PURE
 * half of the product / product-content / reference-price / piece /
 * site-content / audit-log editor surface. No pages, no relays and NO
 * `next/*` imports here — the task-4 relay routes and pages (round B) are
 * built ON this module, mirroring the shipped settings pair
 * (app/admin/api/settings/[key]/route.ts + app/admin/(authed)/settings/page.tsx
 * over lib/admin-settings.ts). English-only admin (app/admin/layout.tsx).
 *
 * ARCHITECTURE (decided; lib/admin-client.ts carries the full relay
 * contract): the browser NEVER calls the Rust API for admin. Reads forward
 * the session cookie (`adminGet`), writes go through web relay routes that
 * forward the SAME cookie and add the X-Requested-With CSRF header
 * (`adminMutate`), so the API's XRW/CSRF contract stays untouched and the
 * admin UI is zero-CORS against the API. Every fetch here is INJECTED
 * (FetchLike) and every mapping is pure, so the whole module is
 * unit-testable without a server (test/admin-editors.test.mjs).
 *
 * SLUG CONTRACT (`editorSlug`): one result slug per mutation outcome — the
 * redirect vocabulary of the round-B relays/pages:
 * - 200/204 -> "saved"           (the write happened; savedKey names it)
 * - 400     -> "invalid"         (the API judged the value; fix the form)
 * - 401     -> "notauthenticated" (session missing/expired; sign in again)
 * - 403     -> "network"         (the XRW leg failed = a RELAY BUG: the
 *               request was rejected BEFORE anything was judged — never a
 *               verdict on the operator's value or session; "invalid" would
 *               claim the field was judged — it was not: retry guidance)
 * - 404     -> "notfound"        (these relays only ever target known rows;
 *               unlike the settings revert — whose DELETE 404 maps to
 *               "saved" as an idempotent revert — a missing row here is
 *               unexpected and is reported honestly)
 * - 409     -> "conflict"        (duplicate slug / piece number)
 * - everything else, incl. status 0 (network/abort) -> "network" (retry
 *   guidance: never claim a save or a verdict when nothing was judged)
 *
 * NEVER-THROWS / NO-SECRETS: every public function resolves a typed result
 * (null on malformed data, a slug on mutation outcomes) — nothing throws,
 * and NOTHING logs (least of all session values or error bodies). The API's
 * error bodies are `{"error": "<string>"}`; the exact 404/409 strings the
 * tests pin as INDEPENDENT LITERALS are exported below
 * (PRODUCT_NOT_FOUND, REFERENCE_PRICE_NOT_FOUND, PIECE_NOT_FOUND,
 * SITE_CONTENT_NOT_FOUND, PRODUCT_SLUG_CONFLICT, PIECE_NO_CONFLICT) and
 * stay in sync with api/src/admin_crud.rs — renaming either side is a
 * breaking cross-tier contract change, not a refactor. The slug mapping is
 * status-only (404 -> notfound is deliberately NOT body-disambiguated: these
 * relays only DELETE known rows), so no error-body extractor is duplicated
 * here — admin-client.ts keeps its private `errorFromBody`.
 *
 * D2a VALIDATION TRUTHS (read from api/src/admin_crud.rs; the API stays the
 * judge — these dispatchers pass values through and map the verdict):
 * - products: slug 1-64 chars of [a-z0-9-]; brand/model non-empty; family
 *   MAY be empty (NUL-only check); price_cents >= 0; art_variant exactly
 *   "dome"|"shades"; art_hue 0-359; active boolean. Create requires EVERY
 *   field; a patch sends ONLY provided keys (missing or null = unchanged;
 *   a patch with no keys is a 400 "no fields to update"). 409 "slug already
 *   in use" (products_slug_key) on create AND slug-changing updates.
 * - product_content: field exactly one of model_alt|colourway|heritage|
 *   electrical (PRODUCT_CONTENT_FIELDS); locale in the configured pair;
 *   value NON-empty (whitespace-only is empty); no NUL. 404 "product not
 *   found". There is no product-content delete (a value is always written).
 * - reference_prices: min/max_price_cents >= 0 and min <= max; source_name
 *   non-empty; source_url absolute http(s):// with host[:port] and no
 *   userinfo; checked_on a REAL calendar date in strict YYYY-MM-DD shape.
 *   DELETE answers 404 "reference price not found" when no row exists.
 * - pieces: piece_no/product_id >= 1. 409 "piece_no already exists"
 *   (pieces_pkey); 404 "piece not found" / "product not found".
 * - site_content: key non-empty (ANY key — no whitelist) and NUL-free,
 *   including on the delete path; locale in the configured pair; value
 *   NON-empty, NUL-free. DELETE answers 404 "site content row not found".
 *   The locale pair is the LOCALES env (exactly two distinct tags; default
 *   en,zh-HK — see DEFAULT_SITE_CONTENT_LOCALES below).
 * - audit_log: read-only (GET), the last 200 rows newest-first, no-store.
 *
 * FORM MODELS: PRODUCT_FIELDS documents every product form field
 * (label + hint, English-only) grouped create-required vs patch-optional;
 * PRODUCT_ART_VARIANTS / PRODUCT_CONTENT_FIELDS pin the closed value sets
 * the form selects offer. Row parsing (parseAdminProduct,
 * parseAdminProducts, parseAuditLog, parseSiteContentMap) is fail-loud
 * per-field validation in the catalog-client spirit, but NULL on malformed
 * instead of throwing: a partial list is a lie, so one malformed row
 * invalidates the whole parse.
 */

import {
  adminGet,
  adminMutate,
  type AdminApiResponse,
  type FetchLike,
} from "./admin-client.ts";
import { isRustBlank } from "./rust-text.ts";

/* ------------------------------------------------------------------ */
/* Cross-tier contract literals (pinned 404/409 bodies)                */
/* ------------------------------------------------------------------ */

/**
 * `PUT /api/admin/products/{id}` 404 (and the product-presence 404 of
 * product-content / reference-price / piece writes). MIRROR of
 * api/src/admin_crud.rs; the tests pin this string as a literal.
 */
export const PRODUCT_NOT_FOUND = "product not found";

/**
 * `DELETE /api/admin/reference-prices/{product_id}` 404 body. MIRROR of
 * api/src/admin_crud.rs; the tests pin this string as a literal.
 */
export const REFERENCE_PRICE_NOT_FOUND = "reference price not found";

/**
 * `DELETE /api/admin/pieces/{piece_no}` 404 body (the PATCH answers the
 * same string for a missing piece). MIRROR of api/src/admin_crud.rs; the
 * tests pin this string as a literal.
 */
export const PIECE_NOT_FOUND = "piece not found";

/**
 * `DELETE /api/admin/site-content/{key}/{locale}` 404 body. MIRROR of
 * api/src/admin_crud.rs; the tests pin this string as a literal.
 */
export const SITE_CONTENT_NOT_FOUND = "site content row not found";

/**
 * 409 body when a slug is already taken (products_slug_key — create AND
 * slug-changing update). MIRROR of api/src/admin_crud.rs; the tests pin
 * this string as a literal.
 */
export const PRODUCT_SLUG_CONFLICT = "slug already in use";

/**
 * 409 body when a piece number already exists (pieces_pkey). MIRROR of
 * api/src/admin_crud.rs; the tests pin this string as a literal.
 */
export const PIECE_NO_CONFLICT = "piece_no already exists";

/* ------------------------------------------------------------------ */
/* Slug contract (pure)                                                */
/* ------------------------------------------------------------------ */

/**
 * The editor outcome vocabulary (the round-B relay redirect slugs).
 * "invalid" = the API judged the request; "notauthenticated" = sign in
 * again; "notfound" = the target row is gone; "conflict" = a uniqueness
 * clash the operator can fix; "network" = nothing was judged (retry).
 */
export type EditorSlug =
  | "saved"
  | "invalid"
  | "notauthenticated"
  | "notfound"
  | "conflict"
  | "network";

/**
 * Map one admin mutation result to its slug (the ONLY layer that decides
 * what an outcome MEANS to the operator):
 * - 200/204 -> "saved";
 * - 400     -> "invalid" (the API judged the value);
 * - 401     -> "notauthenticated";
 * - 403     -> "network" — the XRW CSRF leg failed, a RELAY bug: the API
 *   rejects XRW-less requests BEFORE judging anything, so this is never a
 *   verdict on the operator's value or session (see the module header);
 *   "invalid" would tell the operator their FIELD was judged bad when
 *   nothing was: retry guidance, consistent with the login relay's mapping
 * - 404     -> "notfound" (simple, status-only: these relays only DELETE /
 *   update known rows — unlike the settings revert there is no
 *   idempotent-saved case to disambiguate);
 * - 409     -> "conflict" (duplicate slug / piece number);
 * - everything else — 5xx, 429, ANY UNKNOWN status, and 0 (network/abort:
 *   0 is NOT an HTTP status) -> "network" (retry guidance).
 *
 * `json` is kept in the signature for parity with
 * admin-settings.ts `relayActionSlug` (the round-B relays pass the parsed
 * body); the mapping itself is status-only by contract.
 */
export function editorSlug(status: number, json: unknown): EditorSlug {
  void json;
  if (status === 200 || status === 204) return "saved";
  if (status === 400) return "invalid";
  if (status === 401) return "notauthenticated";
  if (status === 403) return "network";
  if (status === 404) return "notfound";
  if (status === 409) return "conflict";
  return "network";
}

/* ------------------------------------------------------------------ */
/* Row models and parsing (pure; NULL on malformed — never throws)     */
/* ------------------------------------------------------------------ */

function isNonEmptyString(value: unknown): value is string {
  // Rust-exact blankness (lib/rust-text.ts): the D2a validators trim by
  // the Unicode White_Space property — JS trim() additionally drops
  // U+FEFF, so a legal Rust-non-blank value could fail here and strand the
  // row uncorrectable in the UI (review finding).
  return typeof value === "string" && !isRustBlank(value);
}

function isSafeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isIntAtLeast(value: unknown, min: number): value is number {
  return isSafeInt(value) && value >= min;
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return isSafeInt(value) && value >= min && value <= max;
}

/** Placeholder-art variant (D2a validate_art_variant: exactly these two). */
export const PRODUCT_ART_VARIANTS = ["dome", "shades"] as const;

export type ProductArtVariant = (typeof PRODUCT_ART_VARIANTS)[number];

/** True when `value` is one of the closed art-variant set. */
export function isProductArtVariant(value: unknown): value is ProductArtVariant {
  return (
    value === "dome" || value === "shades"
  );
}

/**
 * One `GET /api/admin/products` row (D2a `AdminProduct`), snake_case to
 * mirror the DTO exactly (`created_at` stays the API's ISO string — the
 * page renders it, this layer never reformats). `art_variant` is narrowed
 * to the closed set at parse time (fail-loud, catalog-client style).
 */
export interface AdminProductRow {
  id: number;
  slug: string;
  brand: string;
  model: string;
  price_cents: number;
  /** Series/family name; MAY be empty (the D2a create rule allows it). */
  family: string;
  art_variant: ProductArtVariant;
  art_hue: number;
  active: boolean;
  stock_total: number;
  stock_reserved: number;
  /** ISO timestamp string, as serialized by the API (chrono RFC 3339). */
  created_at: string;
}

/**
 * Map one unknown JSON row to an {@link AdminProductRow}, or null.
 * Fail-loud per-field (catalog-client's `required()` spirit): every field
 * must be present and well-typed — id >= 1, price/stock >= 0 integers,
 * art_hue 0-359, art_variant in the closed set, brand/model non-empty
 * (family may be empty), created_at a non-empty string.
 */
export function parseAdminProduct(row: unknown): AdminProductRow | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return null;
  }
  const r = row as Record<string, unknown>;
  const id = r.id;
  const slug = r.slug;
  const brand = r.brand;
  const model = r.model;
  const priceCents = r.price_cents;
  const family = r.family;
  const artVariant = r.art_variant;
  const artHue = r.art_hue;
  const active = r.active;
  const stockTotal = r.stock_total;
  const stockReserved = r.stock_reserved;
  const createdAt = r.created_at;

  if (!isIntAtLeast(id, 1)) return null;
  if (!isNonEmptyString(slug)) return null;
  if (!isNonEmptyString(brand)) return null;
  if (!isNonEmptyString(model)) return null;
  if (!isIntAtLeast(priceCents, 0)) return null;
  if (typeof family !== "string") return null;
  if (!isProductArtVariant(artVariant)) return null;
  if (!isIntIn(artHue, 0, 359)) return null;
  if (typeof active !== "boolean") return null;
  if (!isIntAtLeast(stockTotal, 0)) return null;
  if (!isIntAtLeast(stockReserved, 0)) return null;
  if (!isNonEmptyString(createdAt)) return null;

  return {
    id,
    slug,
    brand,
    model,
    price_cents: priceCents,
    family,
    art_variant: artVariant,
    art_hue: artHue,
    active,
    stock_total: stockTotal,
    stock_reserved: stockReserved,
    created_at: createdAt,
  };
}

/**
 * Map the `GET /api/admin/products` body (a JSON array) to rows, or null.
 * ALL-or-nothing: one malformed row invalidates the whole parse — a
 * partial product list is a lie (the page would silently lose rows).
 */
export function parseAdminProducts(json: unknown): AdminProductRow[] | null {
  if (!Array.isArray(json)) return null;
  const out: AdminProductRow[] = [];
  for (const row of json) {
    const parsed = parseAdminProduct(row);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Form metadata (pure)                                                */
/* ------------------------------------------------------------------ */

/**
 * Product form field keys, in DTO order (which is also the form order).
 * Every field is REQUIRED on create (the D2a `CreateProduct` DTO has no
 * Option) and OPTIONAL in a patch (a missing key is "leave unchanged").
 */
export type ProductFieldKey =
  | "slug"
  | "brand"
  | "model"
  | "price_cents"
  | "family"
  | "art_variant"
  | "art_hue"
  | "active";

/** The input control one product field renders as. */
export type ProductFieldInput = "text" | "integer" | "select" | "checkbox";

/** Per-field display metadata (English-only admin; see app/admin/layout.tsx). */
export interface ProductFieldMeta {
  key: ProductFieldKey;
  label: string;
  hint: string;
  input: ProductFieldInput;
}

/** Product form metadata grouped by MODE (see {@link PRODUCT_FIELDS}). */
export interface ProductFormFields {
  /** Fields the create form must submit (the D2a create DTO requires all). */
  createRequired: readonly ProductFieldMeta[];
  /** Fields a patch may submit (all optional: missing = leave unchanged). */
  patchOptional: readonly ProductFieldMeta[];
}

const PRODUCT_FIELD_METAS: readonly ProductFieldMeta[] = [
  {
    key: "slug",
    label: "Slug",
    hint: "URL path, lowercase-with-dashes",
    input: "text",
  },
  {
    key: "brand",
    label: "Brand",
    hint: "maker name, e.g. Louis Poulsen",
    input: "text",
  },
  {
    key: "model",
    label: "Model",
    hint: "Latin model name (the en display name)",
    input: "text",
  },
  {
    key: "price_cents",
    label: "Price (cents)",
    hint: "integer minor units, e.g. 161500 = HK$1,615",
    input: "integer",
  },
  {
    key: "family",
    label: "Family",
    hint: "series or family name; may be empty",
    input: "text",
  },
  {
    key: "art_variant",
    label: "Art variant",
    hint: "placeholder art: dome or shades",
    input: "select",
  },
  {
    key: "art_hue",
    label: "Art hue",
    hint: "integer hue",
    input: "integer",
  },
  {
    key: "active",
    label: "Active",
    hint: "on = listed on the storefront; off = hidden (products are never deleted)",
    input: "checkbox",
  },
];

/**
 * Product form metadata grouped create-required vs patch-optional. The D2a
 * `CreateProduct` DTO requires EVERY field and `UpdateProduct` makes EVERY
 * field optional, so both groups hold the same fields: the grouping
 * documents each mode's requiredness, not different memberships (the
 * create form marks all inputs required; the edit form's RELAY omits
 * blank-number and unchecked-checkbox keys — absent = unchanged, so the
 * patch body carries what the form actually changed; a plain HTML form
 * submits EVERY successful control, so "touched" is the relay's mapping,
 * not a browser guarantee).
 */
export const PRODUCT_FIELDS: ProductFormFields = {
  createRequired: PRODUCT_FIELD_METAS,
  patchOptional: PRODUCT_FIELD_METAS,
};

/**
 * The product-content fields the D2a upsert accepts
 * (validate_product_content), pinned for the content-form select. Any
 * other field is a 400 "field must be one of model_alt, colourway,
 * heritage, electrical".
 */
export const PRODUCT_CONTENT_FIELDS = [
  "model_alt",
  "colourway",
  "heritage",
  "electrical",
] as const;

export type ProductContentField = (typeof PRODUCT_CONTENT_FIELDS)[number];

/* ------------------------------------------------------------------ */
/* Write DTOs (snake_case JSON, exactly the D2a request bodies)        */
/* ------------------------------------------------------------------ */

/**
 * `POST /api/admin/products` body (D2a `CreateProduct`): EVERY field
 * required. Plain JSON types on purpose — the API is the judge (its 400
 * maps to "invalid"); this transport layer never pre-judges values.
 */
export interface CreateProductInput {
  slug: string;
  brand: string;
  model: string;
  price_cents: number;
  family: string;
  art_variant: string;
  art_hue: number;
  active: boolean;
}

/**
 * `PUT /api/admin/product-content` body (D2a `ProductContentInput`).
 * `field` is a plain string here (a form value; the API 400s fields
 * outside {@link PRODUCT_CONTENT_FIELDS}).
 */
export interface ProductContentInput {
  product_id: number;
  locale: string;
  field: string;
  value: string;
}

/** `PUT /api/admin/reference-prices/{product_id}` body (D2a `ReferencePriceInput`). */
export interface ReferencePriceInput {
  min_price_cents: number;
  max_price_cents: number;
  source_name: string;
  source_url: string;
  /** Strict `YYYY-MM-DD` (the API validates it as a real calendar date). */
  checked_on: string;
}

/** `POST /api/admin/pieces` body (D2a `PieceInput`). */
export interface PieceInput {
  piece_no: number;
  product_id: number;
}

/** `PUT /api/admin/site-content` body (D2a `SiteContentInput`). */
export interface SiteContentInput {
  key: string;
  locale: string;
  value: string;
}

/* ------------------------------------------------------------------ */
/* Site-content read model (pure; for the round-B locale tabs)         */
/* ------------------------------------------------------------------ */

/**
 * DEFAULT locale pair — MIRROR of the API's `DEFAULT_LOCALES`
 * (api/src/config.rs). The `LOCALES` env var (and its web mirror
 * NEXT_PUBLIC_LOCALES) can replace the pair at deployment (exactly two
 * distinct tags). LOCALE-02 (founder, 2026-10-12) RESTRICTS that pair to
 * en,zh-HK until full i18n exists: changing the pair is a documented code
 * change (the round-B pages/relays render and pre-validate against THIS
 * constant, so a deployed pair change without a code change would strand
 * the forms). The API gates admin content writes on its own configured
 * pair regardless. The pages derive their locale TABS from the LOCALES
 * UNION of the parsed content map (parseSiteContentMap), falling back to
 * this pair only when the content table is empty and no tab can be
 * derived.
 */
export const DEFAULT_SITE_CONTENT_LOCALES = ["en", "zh-HK"] as const;

/**
 * Map the `GET /api/site-content` body (`{content: {key: {locale: value}}}`,
 * api/src/content.rs) to the nested map, or null. Strict, all-or-nothing:
 * every value must be a string and every locale map an object — a partial
 * map would silently drop rows the editor must show. Keys are inserted as
 * OWN properties (Object.fromEntries never triggers the `__proto__`
 * setter): site content keys are admin-writable free text.
 */
export function parseSiteContentMap(
  json: unknown,
): Record<string, Record<string, string>> | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return null;
  }
  const raw = (json as Record<string, unknown>).content;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const out: Array<[string, Record<string, string>]> = [];
  for (const [key, locales] of Object.entries(raw)) {
    if (typeof locales !== "object" || locales === null || Array.isArray(locales)) {
      return null;
    }
    const entry: Array<[string, string]> = [];
    for (const [locale, value] of Object.entries(locales)) {
      if (typeof value !== "string") return null;
      entry.push([locale, value]);
    }
    out.push([key, Object.fromEntries(entry)]);
  }
  return Object.fromEntries(out);
}

/* ------------------------------------------------------------------ */
/* Audit log read model (pure)                                         */
/* ------------------------------------------------------------------ */

/**
 * One `GET /api/admin/audit-log` row (D2a `AuditLogEntry`): `entity_id` is
 * string-or-null; `detail` is UNVALIDATED JSON (the page renders it via
 * JSON.stringify with a fallback) and comes back null when absent.
 */
export interface AuditLogRow {
  id: number;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  /** Arbitrary JSON (or null); rendered by the page, never trusted here. */
  detail: unknown;
  /** ISO timestamp string, as serialized by the API (chrono RFC 3339). */
  created_at: string;
}

/**
 * Map the `GET /api/admin/audit-log` body (a JSON array) to rows, or null.
 * Fail-loud per-field: id > 0 integer; actor/action/entity/created_at
 * non-empty strings; entity_id a non-empty string or null; `detail` is
 * passed through untouched (missing key becomes null). One malformed row
 * invalidates the whole parse — a partial audit trail is a lie.
 */
export function parseAuditLog(json: unknown): AuditLogRow[] | null {
  if (!Array.isArray(json)) return null;
  const out: AuditLogRow[] = [];
  for (const row of json) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return null;
    }
    const r = row as Record<string, unknown>;
    const id = r.id;
    const actor = r.actor;
    const action = r.action;
    const entity = r.entity;
    const rawEntityId = r.entity_id;
    const createdAt = r.created_at;

    if (!isIntAtLeast(id, 1)) return null;
    if (!isNonEmptyString(actor)) return null;
    if (!isNonEmptyString(action)) return null;
    if (!isNonEmptyString(entity)) return null;
    // Rejects undefined/""/non-strings; survives values are null or a
    // non-empty string (the DTO always emits the key).
    if (rawEntityId !== null && !isNonEmptyString(rawEntityId)) return null;
    if (!isNonEmptyString(createdAt)) return null;

    out.push({
      id,
      actor,
      action,
      entity,
      entity_id: isNonEmptyString(rawEntityId) ? rawEntityId : null,
      // Unvalidated JSON passthrough (nullish -> null; everything else —
      // numbers, booleans, arrays, objects — is preserved as-is).
      detail: r.detail ?? null,
      created_at: createdAt,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Mutation dispatch (pure logic, injectable fetch)                    */
/* ------------------------------------------------------------------ */

/** Outcome of one editor dispatch: slug + the entity saved (for `?saved=`). */
export interface DispatchEditorResult {
  slug: EditorSlug;
  /** Describe the saved entity when `slug` is "saved"; null otherwise. */
  savedKey: string | null;
}

/**
 * The JSON body for a create/patch: D2a DTO field order, with UNDEFINED
 * keys OMITTED (a missing key is "leave unchanged" on the API side, and
 * JSON null also decodes as unchanged — so only provided keys are sent).
 */
function productBody(patch: Partial<CreateProductInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.slug !== undefined) body.slug = patch.slug;
  if (patch.brand !== undefined) body.brand = patch.brand;
  if (patch.model !== undefined) body.model = patch.model;
  if (patch.price_cents !== undefined) body.price_cents = patch.price_cents;
  if (patch.family !== undefined) body.family = patch.family;
  if (patch.art_variant !== undefined) body.art_variant = patch.art_variant;
  if (patch.art_hue !== undefined) body.art_hue = patch.art_hue;
  if (patch.active !== undefined) body.active = patch.active;
  return body;
}

/**
 * Shared dispatch core: `adminMutate` (lib/admin-client.ts) forwards the
 * session cookie and adds the X-Requested-With CSRF header, and its
 * never-throws `{status, json}` contract means this resolves a slug for
 * every outcome. `savedKey` is attached only on "saved" (the relay puts it
 * in `?saved=`).
 */
async function dispatchMutation(
  apiUrl: string,
  path: string,
  method: string,
  body: unknown,
  savedKey: string,
  sessionValue: string,
  fetchImpl: FetchLike,
): Promise<DispatchEditorResult> {
  const result = await adminMutate(
    apiUrl,
    path,
    method,
    sessionValue,
    body,
    fetchImpl,
  );
  const slug = editorSlug(result.status, result.json);
  return { slug, savedKey: slug === "saved" ? savedKey : null };
}

/**
 * `POST /api/admin/products` — create a product from the full create DTO
 * (every field required; the API 400s otherwise). 409 -> "conflict"
 * (duplicate slug). savedKey: `product <slug>` (the create knows the slug,
 * not the id).
 */
export async function dispatchCreateProduct(
  apiUrl: string,
  input: CreateProductInput,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchEditorResult> {
  return dispatchMutation(
    apiUrl,
    "/api/admin/products",
    "POST",
    productBody(input),
    `product ${input.slug}`,
    sessionValue,
    fetchImpl,
  );
}

/**
 * `PUT /api/admin/products/{id}` — partial update. ONLY provided keys are
 * sent (undefined keys are omitted; absent = unchanged). 404 -> "notfound"
 * (missing id), 409 -> "conflict" (slug taken). savedKey: `product <id>`.
 */
export async function dispatchUpdateProduct(
  apiUrl: string,
  id: number,
  patch: Partial<CreateProductInput>,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchEditorResult> {
  return dispatchMutation(
    apiUrl,
    `/api/admin/products/${id}`,
    "PUT",
    productBody(patch),
    `product ${id}`,
    sessionValue,
    fetchImpl,
  );
}

/**
 * `PUT /api/admin/product-content` — upsert one (product, locale, field)
 * copy row. 404 -> "notfound" (missing product), 400 -> "invalid" (field
 * outside PRODUCT_CONTENT_FIELDS / locale outside the configured pair /
 * empty value). savedKey: `<product_id> <locale> <field>`.
 */
export async function dispatchUpsertProductContent(
  apiUrl: string,
  input: ProductContentInput,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchEditorResult> {
  return dispatchMutation(
    apiUrl,
    "/api/admin/product-content",
    "PUT",
    {
      product_id: input.product_id,
      locale: input.locale,
      field: input.field,
      value: input.value,
    },
    `${input.product_id} ${input.locale} ${input.field}`,
    sessionValue,
    fetchImpl,
  );
}

/**
 * `PUT /api/admin/reference-prices/{product_id}` — upsert the product's
 * single verified reference range. 404 -> "notfound" (missing product).
 * savedKey: `reference price for product <product_id>`.
 */
export async function dispatchUpsertReferencePrice(
  apiUrl: string,
  productId: number,
  input: ReferencePriceInput,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchEditorResult> {
  return dispatchMutation(
    apiUrl,
    `/api/admin/reference-prices/${productId}`,
    "PUT",
    {
      min_price_cents: input.min_price_cents,
      max_price_cents: input.max_price_cents,
      source_name: input.source_name,
      source_url: input.source_url,
      checked_on: input.checked_on,
    },
    `reference price for product ${productId}`,
    sessionValue,
    fetchImpl,
  );
}

/**
 * `DELETE /api/admin/reference-prices/{product_id}` — remove the verified
 * reference (= verification pending again). No body is needed (the D2a
 * handler extracts none; adminMutate sends the inert `{}`, like the
 * settings revert). 404 -> "notfound" — NOT an idempotent save: these
 * relays only delete rows the page is showing. savedKey: `reference price
 * for product <product_id>`.
 */
export async function dispatchDeleteReferencePrice(
  apiUrl: string,
  productId: number,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchEditorResult> {
  return dispatchMutation(
    apiUrl,
    `/api/admin/reference-prices/${productId}`,
    "DELETE",
    {},
    `reference price for product ${productId}`,
    sessionValue,
    fetchImpl,
  );
}

/**
 * `POST /api/admin/pieces` — number a new physical piece of the drop.
 * 404 -> "notfound" (missing product), 409 -> "conflict" (piece number
 * taken). savedKey: `piece <piece_no>`.
 */
export async function dispatchCreatePiece(
  apiUrl: string,
  input: PieceInput,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchEditorResult> {
  return dispatchMutation(
    apiUrl,
    "/api/admin/pieces",
    "POST",
    { piece_no: input.piece_no, product_id: input.product_id },
    `piece ${input.piece_no}`,
    sessionValue,
    fetchImpl,
  );
}

/**
 * `PATCH /api/admin/pieces/{piece_no}` — reassign a piece to another
 * product (body: the new `product_id`). 404 -> "notfound" (missing piece
 * OR missing product). savedKey: `piece <piece_no>`.
 */
export async function dispatchReassignPiece(
  apiUrl: string,
  pieceNo: number,
  productId: number,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchEditorResult> {
  return dispatchMutation(
    apiUrl,
    `/api/admin/pieces/${pieceNo}`,
    "PATCH",
    { product_id: productId },
    `piece ${pieceNo}`,
    sessionValue,
    fetchImpl,
  );
}

/**
 * `DELETE /api/admin/pieces/{piece_no}` — remove a piece number from the
 * drop. 404 -> "notfound" (no such piece). savedKey: `piece <piece_no>`.
 */
export async function dispatchDeletePiece(
  apiUrl: string,
  pieceNo: number,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchEditorResult> {
  return dispatchMutation(
    apiUrl,
    `/api/admin/pieces/${pieceNo}`,
    "DELETE",
    {},
    `piece ${pieceNo}`,
    sessionValue,
    fetchImpl,
  );
}

/**
 * `PUT /api/admin/site-content` — upsert one (key, locale) site copy row.
 * 400 -> "invalid" (empty key/value / locale outside the configured pair).
 * savedKey: `<key> (<locale>)`.
 */
/**
 * Transport-safe site-content KEY check (review finding): `encodeURIComponent`
 * leaves `.` and `..` unchanged, and WHATWG URL parsing then normalizes
 * those path segments AWAY (".../site-content/../en" addresses
 * ".../site-content/en"), so a `.`/`..` key can be CREATED but never
 * addressed for DELETE — a stuck row. The API accepts any non-empty NUL-free
 * key (its contract), so the WEB tier closes the edge honestly: a key that
 * cannot round-trip the path transport is rejected HERE as `invalid`
 * without dispatch (manage such pathological rows via SQL/other clients).
 */
export function isTransportSafeKey(key: string): boolean {
  return key !== "." && key !== "..";
}

export async function dispatchUpsertSiteContent(
  apiUrl: string,
  input: SiteContentInput,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchEditorResult> {
  if (!isTransportSafeKey(input.key)) {
    return { slug: "invalid", savedKey: null };
  }
  return dispatchMutation(
    apiUrl,
    "/api/admin/site-content",
    "PUT",
    { key: input.key, locale: input.locale, value: input.value },
    `${input.key} (${input.locale})`,
    sessionValue,
    fetchImpl,
  );
}

/**
 * `DELETE /api/admin/site-content/{key}/{locale}` — remove one site copy
 * row. BOTH path segments are URL-encoded (site content keys are free text
 * — dots, slashes, spaces — and the row identity is the (key, locale)
 * pair). 404 -> "notfound" (no such row). savedKey: `<key> (<locale>)`.
 */
export async function dispatchDeleteSiteContent(
  apiUrl: string,
  key: string,
  locale: string,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<DispatchEditorResult> {
  // Same transport-safety guard as the upsert (isTransportSafeKey): a
  // `.`/`..` key cannot be addressed through the URL path at all.
  if (!isTransportSafeKey(key)) {
    return { slug: "invalid", savedKey: null };
  }
  return dispatchMutation(
    apiUrl,
    `/api/admin/site-content/${encodeURIComponent(key)}/${encodeURIComponent(locale)}`,
    "DELETE",
    {},
    `${key} (${locale})`,
    sessionValue,
    fetchImpl,
  );
}

/**
 * `GET /api/admin/audit-log` — the last 200 audit rows, newest first
 * (no-store on the API side). A READ, so it resolves the raw
 * `{status, json}` pair (adminGet's never-throws contract; status 0 =
 * network/abort) — pair it with {@link parseAuditLog}. The page maps
 * failures with {@link editorSlug} itself.
 */
export async function dispatchGetAuditLog(
  apiUrl: string,
  sessionValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<AdminApiResponse> {
  return adminGet(apiUrl, "/api/admin/audit-log", sessionValue, fetchImpl);
}

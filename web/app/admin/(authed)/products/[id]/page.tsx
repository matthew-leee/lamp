import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { adminGet } from "../../../../../lib/admin-client.ts";
import {
  getProduct,
  parseCatalogue,
  type Catalogue,
  type ProductContent,
} from "../../../../../lib/catalog-client.ts";
import {
  DEFAULT_SITE_CONTENT_LOCALES,
  PRODUCT_ART_VARIANTS,
  PRODUCT_CONTENT_FIELDS,
  PRODUCT_FIELDS,
  parseAdminProducts,
  type AdminProductRow,
  type ProductContentField,
  type ProductFieldMeta,
} from "../../../../../lib/admin-editors.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../../lib/admin-session.ts";

/*
  Admin product detail page (D2b task 4, ADMIN-01): one product, four
  editor surfaces — (a) the product patch form, (b) per-locale/per-field
  product copy, (c) the verified reference price, (d) the numbered pieces.
  Plain HTML forms with NO client JS; ENGLISH-ONLY admin
  (app/admin/layout.tsx); `globals.css` token classes only (CSS-01).

  READS (two sources, deliberately):
  - `GET /api/admin/products` via `adminGet` (session forwarded) -> the
    ADMIN row for THIS product: id, stock and every field the patch form
    prefills. Malformed / non-200 / id not found -> fail-loud panel and NO
    forms (never render invented state).
  - PUBLIC `GET /api/catalogue` (plain fetch, `cache: "no-store"` — this is
    a force-dynamic server component, no store) -> the product's content
    map (locale -> fields), pieces and reference price. The catalogue lists
    ACTIVE products only: a product missing from it is NOT an error (it is
    exactly what "inactive" means) — the sections then show honest
    "cannot show current values" notes while the forms still upsert. A
    fetch/parse FAILURE (small local helper -> null) is fail-loud with NO
    forms. Note there is NO admin read for product-content / reference
    price / pieces (D2a): the public catalogue is the only read surface.

  WRITES go through the relays under app/admin/api/ (products/[id],
  product-content, reference-prices/[product_id], pieces,
  pieces/[piece_no]) — one plain form per row/action. Relays answer 303
  with a slug-only query on THIS page (the form's page): `?saved=<savedKey>`
  / `?error=<slug>`; raw API error text never enters a URL.

  `?saved=` is echoed only when it matches the CLOSED pattern of savedKeys
  the round-A dispatchers targeting this page produce (`product <id>`,
  `<id> <locale> <field>`, `reference price for product <id>`,
  `piece <no>`); anything else is ignored. `?error=` maps through a Map
  with a generic fallback (untrusted values can never reach an inherited
  property).

  `export const dynamic = "force-dynamic"` (admin views show CURRENT DB
  state, never cached) and params/searchParams are Promises in Next 15.
*/

export const metadata: Metadata = { title: "Product" };

/** Served per request: admin state is live DB state, never cache it. */
export const dynamic = "force-dynamic";

/** Slug -> operator-facing message (exact strings, safe to render). */
const errorMessages = new Map<string, string>([
  ["invalid", "Invalid value — not saved. Check the field hints."],
  ["notauthenticated", "Session expired — sign in again."],
  [
    "notfound",
    "Not found — the row may have changed underneath you; reload.",
  ],
  ["conflict", "Already exists (duplicate slug or piece number)."],
  [
    "network",
    "The admin API is unreachable or rejected the change — retry later.",
  ],
]);

/**
 * Closed allowlist pattern for `?saved=`: every savedKey the round-A
 * dispatchers targeting THIS page can produce — `dispatchUpdateProduct`:
 * `product <id>`; `dispatchUpsertProductContent`: `<id> <locale> <field>`;
 * reference prices: `reference price for product <id>`;
 * `dispatchCreatePiece`/`dispatchReassignPiece`/`dispatchDeletePiece`:
 * `piece <no>`. Built from the round-A closed sets so it cannot drift.
 */
const savedKeyPattern = new RegExp(
  "^(?:product [0-9]+|" +
    `[0-9]+ (?:${DEFAULT_SITE_CONTENT_LOCALES.join("|")}) (?:${PRODUCT_CONTENT_FIELDS.join("|")})|` +
    "reference price for product [0-9]+|piece [0-9]+)$",
);

/** The shared text-input classes (mirrors the settings page). */
const inputClasses =
  "border border-sand bg-bone px-3 py-2 text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow";

/** The shared Save-button classes (mirrors the settings page). */
const saveButtonClasses =
  "border border-charcoal px-5 py-2 text-sm text-charcoal transition-colors duration-200 hover:border-glow hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow";

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Catalogue view (public read: content / pieces / reference price)     */
/* ------------------------------------------------------------------ */

/**
 * The product's reference price view (snake_case display keys, mapped from
 * the parsed catalogue product's camelCase `referencePrice`).
 */
interface ReferencePriceView {
  min_price_cents: number;
  max_price_cents: number;
  source_name: string;
  source_url: string;
  checked_on: string;
}

interface CatalogueProductView {
  /**
   * False when the catalogue has no row for the slug: the catalogue lists
   * ACTIVE products only, so an inactive product is legitimately absent —
   * the forms still work, current values just cannot be SHOWN.
   */
  present: boolean;
  /** locale -> the copy fields that have rows (blank rows are absent). */
  content: Record<string, Record<string, string>>;
  /** This product's piece numbers, ascending. */
  pieces: number[];
  referencePrice: ReferencePriceView | null;
}

/** camelCase content field -> its snake_case PRODUCT_CONTENT_FIELDS key. */
const CONTENT_FIELD_TO_FORM: Record<keyof ProductContent, string> = {
  modelAlt: "model_alt",
  colourway: "colourway",
  heritage: "heritage",
  electrical: "electrical",
};

/**
 * Read the product's catalogue view by slug (the slug is the catalogue's
 * key; the admin row owns the id). NEVER throws: an unreachable API, a
 * non-200, or a MALFORMED catalogue resolves null (-> the page's fail-loud
 * panel) — the response is parsed by the STOREFRONT'S OWN parser
 * (`parseCatalogue`, lib/catalog-client.ts; adminGet carries the shared
 * abort budget), so the admin view's contract is the storefront's by
 * construction (review finding: the hand-rolled parser had drifted). A
 * LEGITIMATE absence (inactive product — the catalogue lists active
 * products only) resolves the empty `present: false` view.
 */
async function fetchCatalogueProduct(
  apiUrl: string,
  slug: string,
  sessionValue: string,
): Promise<CatalogueProductView | null> {
  const read = await adminGet(apiUrl, "/api/catalogue", sessionValue);
  if (read.status !== 200) return null;
  let catalogue: Catalogue;
  try {
    // allowEmpty: the ADMIN reader accepts an all-inactive catalogue (an
    // empty active set is legitimate HERE — the detail page must still
    // render the Activate form after the last active product is hidden,
    // review finding). Structural validity + row parsing stay enforced.
    catalogue = parseCatalogue(read.json, { allowEmpty: true });
  } catch {
    return null;
  }
  const product = getProduct(catalogue, slug);
  if (product === undefined) {
    return { present: false, content: {}, pieces: [], referencePrice: null };
  }
  const content: Record<string, Record<string, string>> = {};
  for (const [locale, fields] of Object.entries(product.content)) {
    const entry: Record<string, string> = {};
    for (const [camel, snake] of Object.entries(
      CONTENT_FIELD_TO_FORM,
    ) as [keyof ProductContent, string][]) {
      const value = fields[camel];
      if (typeof value === "string") entry[snake] = value;
    }
    content[locale] = entry;
  }
  return {
    present: true,
    content,
    pieces: product.pieces,
    referencePrice:
      product.referencePrice === null
        ? null
        : {
            min_price_cents: product.referencePrice.minPriceCents,
            max_price_cents: product.referencePrice.maxPriceCents,
            source_name: product.referencePrice.sourceName,
            source_url: product.referencePrice.sourceUrl,
            checked_on: product.referencePrice.checkedOn,
          },
  };
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

/**
 * Render one patch-form control prefilled from the ADMIN row. The patch
 * sends only provided fields (see the form's comment), so no input is
 * `required`: blank text -> the API 400s empty slug/brand/model honestly,
 * blank number -> omitted (unchanged), unchecked active -> omitted.
 */
function patchInput(meta: ProductFieldMeta, row: AdminProductRow): ReactNode {
  const id = `product-${meta.key}`;
  const hintId = `${id}-hint`;
  if (meta.input === "select") {
    return (
      <select
        id={id}
        name={meta.key}
        defaultValue={row.art_variant}
        aria-describedby={hintId}
        className={inputClasses}
      >
        {PRODUCT_ART_VARIANTS.map((variant) => (
          <option key={variant} value={variant}>
            {variant}
          </option>
        ))}
      </select>
    );
  }
  if (meta.input === "checkbox") {
    return (
      <input
        id={id}
        name={meta.key}
        type="checkbox"
        defaultChecked={row.active}
        value="true"
        aria-describedby={hintId}
        className="h-4 w-4 border border-sand accent-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
      />
    );
  }
  if (meta.input === "integer") {
    return (
      <input
        id={id}
        name={meta.key}
        type="number"
        step={1}
        min={0}
        max={meta.key === "art_hue" ? 359 : undefined}
        defaultValue={
          meta.key === "price_cents"
            ? row.price_cents
            : meta.key === "art_hue"
              ? row.art_hue
              : ""
        }
        aria-describedby={hintId}
        className={inputClasses}
      />
    );
  }
  return (
    <input
      id={id}
      name={meta.key}
      type="text"
      defaultValue={
        meta.key === "slug"
          ? row.slug
          : meta.key === "brand"
            ? row.brand
            : meta.key === "model"
              ? row.model
              : row.family
      }
      aria-describedby={hintId}
      className={inputClasses}
    />
  );
}

/** One product-content field's form (locale x field). */
function productContentFieldId(
  locale: string,
  field: ProductContentField,
): string {
  return `content-${locale}-${field}`;
}

interface AdminProductPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}

export default async function AdminProductPage({
  params,
  searchParams,
}: AdminProductPageProps) {
  // Session gate (whoami-confirmed; redirects when missing/expired) plus the
  // raw cookie value for the API read.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";

  const { id: rawId } = await params;
  const fetched = await adminGet(apiUrl, "/api/admin/products", sessionValue);
  const rows = fetched.status === 200 ? parseAdminProducts(fetched.json) : null;
  const id = Number(rawId);
  const row =
    rows !== null && Number.isSafeInteger(id) && id >= 1
      ? (rows.find((candidate) => candidate.id === id) ?? null)
      : null;

  const catalogue =
    row === null
      ? null
      : await fetchCatalogueProduct(apiUrl, row.slug, sessionValue);

  const { saved, error } = await searchParams;
  const savedMessage =
    saved !== undefined && savedKeyPattern.test(saved)
      ? `Saved ${saved} — the storefront's 60-second content lease expires; the next request serves the last-good value while the fresh one regenerates in the background.`
      : null;
  const errorMessage =
    error === undefined ? null : (errorMessages.get(error) ?? "Nothing saved.");

  if (rows === null) {
    // Fail loud, render NOTHING else: forms over unknown state are lies.
    return (
      <section className="flex flex-col gap-4">
        <h1 className="font-serif text-2xl font-normal">Product</h1>
        <p
          role="alert"
          className="border-l-4 border-glow-ember pl-4 text-lg leading-relaxed text-charcoal"
        >
          Products could not be loaded from the API — retry later.
        </p>
        <Link href="/admin/products" className="text-sm text-ink-soft underline">
          ← Back to products
        </Link>
      </section>
    );
  }

  if (row === null) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="font-serif text-2xl font-normal">Product</h1>
        <p
          role="alert"
          className="border-l-4 border-glow-ember pl-4 text-lg leading-relaxed text-charcoal"
        >
          Product not found.
        </p>
        <Link href="/admin/products" className="text-sm text-ink-soft underline">
          ← Back to products
        </Link>
      </section>
    );
  }

  if (catalogue === null) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="font-serif text-2xl font-normal">
          {row.brand} · {row.model}
        </h1>
        <p
          role="alert"
          className="border-l-4 border-glow-ember pl-4 text-lg leading-relaxed text-charcoal"
        >
          Product content could not be loaded from the API — retry later.
        </p>
        <Link href="/admin/products" className="text-sm text-ink-soft underline">
          ← Back to products
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-normal">
          {row.brand} · {row.model}
        </h1>
        <p className="text-base leading-relaxed text-ink-soft">
          Product {row.id} · slug <code>{row.slug}</code> ·{" "}
          {row.active ? "active" : "inactive (hidden from the storefront)"} ·
          stock {row.stock_total} total / {row.stock_reserved} reserved.
        </p>
      </div>

      {savedMessage !== null && (
        <p
          role="status"
          className="border-l-4 border-glow pl-4 text-lg leading-relaxed text-charcoal"
        >
          {savedMessage}
        </p>
      )}

      {errorMessage !== null && (
        <p
          role="alert"
          className="border-l-4 border-glow-ember pl-4 text-lg leading-relaxed text-charcoal"
        >
          {errorMessage}
        </p>
      )}

      {!catalogue.present && (
        <p
          role="status"
          className="border border-sand px-4 py-3 text-lg leading-relaxed text-charcoal"
        >
          This product is not in the public catalogue (it lists ACTIVE
          products only), so current copy, reference price and pieces cannot
          be shown here. The forms below still write their rows.
        </p>
      )}

      {/* (a) Product patch form. PATCH SEMANTICS (the relay mirrors this):
          the patch sends the provided fields only — a BLANK number input is
          omitted (unchanged), an UNCHECKED active box is omitted
          (unchanged; there is no hidden companion here, unlike the create
          form), and blank TEXT fields are sent blank so the API 400s empty
          slug/brand/model honestly. */}
      <form
        method="post"
        action={`/admin/api/products/${row.id}`}
        className="flex max-w-xl flex-col gap-3 border-t border-sand pt-6"
      >
        <h2 className="font-serif text-xl font-normal">Product fields</h2>
        {PRODUCT_FIELDS.patchOptional.map((meta) => {
          const id = `product-${meta.key}`;
          const hintId = `${id}-hint`;
          return (
            <div key={meta.key} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-base text-charcoal">
                {meta.label}
              </label>
              {patchInput(meta, row)}
              <p id={hintId} className="text-sm text-ink-soft">
                {meta.hint}
              </p>
            </div>
          );
        })}
        <div>
          <button type="submit" name="action" value="save" className={saveButtonClasses}>
            Save
          </button>
        </div>
      </form>

      {/* Storefront visibility (review finding): the patch form's active
          checkbox submits "true" when checked and OMITS when unchecked
          (unchanged) — so the patch form alone can never turn a product
          OFF. This explicit single-field form does: hidden active=false ->
          Deactivate, hidden active=true -> Activate (same relay, action=save
          -> the D2a partial patch). */}
      <form
        method="post"
        action={`/admin/api/products/${row.id}`}
        className="flex max-w-xl flex-col gap-2 border-t border-sand pt-6"
      >
        <p className="text-base text-charcoal">
          Storefront visibility: {row.active ? "active (listed)" : "inactive (hidden)"}
        </p>
        <input type="hidden" name="active" value={row.active ? "false" : "true"} />
        <div>
          <button
            type="submit"
            name="action"
            value="save"
            className="border border-charcoal px-5 py-2 text-sm text-charcoal transition-colors duration-200 hover:border-glow hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
          >
            {row.active ? "Deactivate (hide from storefront)" : "Activate (show on storefront)"}
          </button>
        </div>
        <p className="text-sm text-ink-soft">
          Route-set changes need a rebuild: activating or deactivating changes
          WHICH pages exist (`generateStaticParams`), so the storefront
          serves the old route set until the next build (the 60s lease only
          refreshes existing routes&apos; content).
        </p>
      </form>

      {/* (b) Product copy: one upsert form per locale x field, prefilled
          from the catalogue (a missing row renders an EMPTY input). The
          value must be NON-empty — there is no clearing: a blank save is
          rejected by the API (400 -> "Invalid value"). */}
      <div className="flex flex-col gap-4 border-t border-sand pt-6">
        <h2 className="font-serif text-xl font-normal">Product copy</h2>
        <p className="text-sm text-ink-soft">
          Every value must be non-empty (a copy row is always written;
          blank cannot clear a row). Saving a field without a row creates
          it.
        </p>
        {DEFAULT_SITE_CONTENT_LOCALES.map((locale) => (
          <div key={locale} className="flex flex-col gap-3">
            <h3 className="text-base text-charcoal">Locale {locale}</h3>
            {PRODUCT_CONTENT_FIELDS.map((field) => {
              const inputId = productContentFieldId(locale, field);
              const current = catalogue.content[locale]?.[field] ?? "";
              const exists =
                catalogue.present &&
                typeof catalogue.content[locale]?.[field] === "string";
              return (
                <form
                  key={field}
                  method="post"
                  action="/admin/api/product-content"
                  className="flex max-w-xl flex-col gap-1 border-t border-sand pt-3"
                >
                  <label htmlFor={inputId} className="text-base text-charcoal">
                    {field}
                  </label>
                  <input type="hidden" name="product_id" value={row.id} />
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="field" value={field} />
                  <input
                    id={inputId}
                    name="value"
                    type="text"
                    defaultValue={current}
                    className={inputClasses}
                  />
                  <p className="text-sm text-ink-soft">
                    {!catalogue.present
                      ? "Row state unknown (not in the public catalogue) — saving writes it."
                      : exists
                        ? `Row exists for ${locale} · ${field}.`
                        : `No row for ${locale} · ${field} yet — saving creates it.`}
                  </p>
                  <div>
                    <button
                      type="submit"
                      name="action"
                      value="save"
                      className={saveButtonClasses}
                    >
                      Save
                    </button>
                  </div>
                </form>
              );
            })}
          </div>
        ))}
      </div>

      {/* (c) Reference price: one verified range per product. Save
          upserts; Delete removes the row (= verification pending again) —
          only offered when a row demonstrably exists (the delete 404s
          otherwise, and the page never shows a button for a row it is not
          showing). */}
      <div className="flex flex-col gap-3 border-t border-sand pt-6">
        <h2 className="font-serif text-xl font-normal">Reference price</h2>
        <p className="text-sm text-ink-soft">
          {catalogue.referencePrice !== null
            ? `Current: ${catalogue.referencePrice.min_price_cents}–${catalogue.referencePrice.max_price_cents} cents from ${catalogue.referencePrice.source_name} (${catalogue.referencePrice.source_url}), checked ${catalogue.referencePrice.checked_on}.`
            : catalogue.present
              ? "No verified reference price — the storefront shows it as pending."
              : "Reference price state unknown (not in the public catalogue)."}
        </p>
        <form
          method="post"
          action={`/admin/api/reference-prices/${row.id}`}
          className="flex max-w-xl flex-col gap-3 border-t border-sand pt-3"
        >
          <label htmlFor="ref-min" className="text-base text-charcoal">
            Min price (cents)
          </label>
          <input
            id="ref-min"
            name="min_price_cents"
            type="number"
            step={1}
            min={0}
            defaultValue={catalogue.referencePrice?.min_price_cents ?? ""}
            className={inputClasses}
          />
          <label htmlFor="ref-max" className="text-base text-charcoal">
            Max price (cents)
          </label>
          <input
            id="ref-max"
            name="max_price_cents"
            type="number"
            step={1}
            min={0}
            defaultValue={catalogue.referencePrice?.max_price_cents ?? ""}
            className={inputClasses}
          />
          <label htmlFor="ref-name" className="text-base text-charcoal">
            Source name
          </label>
          <input
            id="ref-name"
            name="source_name"
            type="text"
            defaultValue={catalogue.referencePrice?.source_name ?? ""}
            className={inputClasses}
          />
          <label htmlFor="ref-url" className="text-base text-charcoal">
            Source URL
          </label>
          <input
            id="ref-url"
            name="source_url"
            type="text"
            defaultValue={catalogue.referencePrice?.source_url ?? ""}
            className={inputClasses}
          />
          <p className="text-sm text-ink-soft">
            Absolute http(s) URL with a host (no sign-in part); the API
            validates it.
          </p>
          <label htmlFor="ref-checked" className="text-base text-charcoal">
            Checked on
          </label>
          <input
            id="ref-checked"
            name="checked_on"
            type="text"
            defaultValue={catalogue.referencePrice?.checked_on ?? ""}
            className={inputClasses}
          />
          <p className="text-sm text-ink-soft">
            A real calendar date, strict YYYY-MM-DD (e.g. 2026-01-31).
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              name="action"
              value="save"
              className={saveButtonClasses}
            >
              Save
            </button>
            {catalogue.referencePrice !== null && (
              <button
                type="submit"
                name="action"
                value="delete"
                className="border border-sand px-5 py-2 text-sm text-ink-soft transition-colors duration-200 hover:border-glow-ember hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
              >
                Delete (verification pending again)
              </button>
            )}
          </div>
        </form>
      </div>

      {/* (d) Pieces of this product (the catalogue's piece list). Two forms
          per piece: reassign (the number input is the NEW product id —
          both the mutation input and the page the relay returns to) and
          delete (the relay falls back to the product list: after the
          delete there is no piece row to return to). Creating a piece
          targets THIS product. */}
      <div className="flex flex-col gap-4 border-t border-sand pt-6">
        <h2 className="font-serif text-xl font-normal">Pieces</h2>
        {catalogue.present ? (
          catalogue.pieces.length > 0 ? (
            <table className="w-full border-collapse text-sm text-charcoal">
              <thead>
                <tr className="border-b border-charcoal">
                  <th className="px-3 py-2 text-left font-normal text-ink-soft">
                    Piece #
                  </th>
                  <th className="px-3 py-2 text-left font-normal text-ink-soft">
                    Reassign to product
                  </th>
                  <th className="px-3 py-2 text-left font-normal text-ink-soft">
                    Delete
                  </th>
                </tr>
              </thead>
              <tbody>
                {catalogue.pieces.map((pieceNo) => (
                  <tr key={pieceNo} className="border-b border-sand">
                    <td className="px-3 py-2">{pieceNo}</td>
                    <td className="px-3 py-2">
                      <form
                        method="post"
                        action={`/admin/api/pieces/${pieceNo}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <label
                          htmlFor={`reassign-${pieceNo}`}
                          className="sr-only"
                        >
                          New product id for piece {pieceNo}
                        </label>
                        <input
                          id={`reassign-${pieceNo}`}
                          name="product_id"
                          type="number"
                          step={1}
                          min={1}
                          placeholder="product id"
                          className={inputClasses}
                        />
                        <button
                          type="submit"
                          name="action"
                          value="reassign"
                          className={saveButtonClasses}
                        >
                          Reassign
                        </button>
                      </form>
                    </td>
                    <td className="px-3 py-2">
                      <form method="post" action={`/admin/api/pieces/${pieceNo}`}>
                        <button
                          type="submit"
                          name="action"
                          value="delete"
                          className="border border-sand px-4 py-1.5 text-sm text-ink-soft transition-colors duration-200 hover:border-glow-ember hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
                        >
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-base leading-relaxed text-ink-soft">
              No pieces numbered for this product yet.
            </p>
          )
        ) : (
          <p className="text-base leading-relaxed text-ink-soft">
            Pieces cannot be listed (the product is not in the public
            catalogue); the create-piece form below still works — a new
            piece can be created for this product.
          </p>
        )}
        <form
          method="post"
          action="/admin/api/pieces"
          className="flex max-w-xl flex-col gap-3 border-t border-sand pt-3"
        >
          <label htmlFor="new-piece-no" className="text-base text-charcoal">
            New piece number
          </label>
          <input type="hidden" name="product_id" value={row.id} />
          <input
            id="new-piece-no"
            name="piece_no"
            type="number"
            step={1}
            min={1}
            className={inputClasses}
          />
          <p className="text-sm text-ink-soft">
            Integer ≥ 1, unique across the whole drop; the piece is numbered
            to THIS product ({row.slug}).
          </p>
          <div>
            <button
              type="submit"
              name="action"
              value="create"
              className={saveButtonClasses}
            >
              Add piece
            </button>
          </div>
        </form>
      </div>

      <Link href="/admin/products" className="text-sm text-ink-soft underline">
        ← Back to products
      </Link>
    </section>
  );
}

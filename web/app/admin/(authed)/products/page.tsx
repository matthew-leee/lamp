import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { adminGet } from "../../../../lib/admin-client.ts";
import {
  PRODUCT_ART_VARIANTS,
  PRODUCT_FIELDS,
  parseAdminProducts,
  type ProductFieldMeta,
} from "../../../../lib/admin-editors.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../lib/admin-session.ts";
import { formatMoney } from "../../../../lib/money.ts";

/*
  Admin products page (D2b task 4, ADMIN-01): the product list (ALL rows,
  inactive included — stock/admin-only fields come from
  `GET /api/admin/products`) plus the create form. Plain HTML forms with
  NO client JS; ENGLISH-ONLY admin (app/admin/layout.tsx); `globals.css`
  token classes only (CSS-01 — no inline styles, no hex).

  Reads `GET /api/admin/products` through `adminGet` (session forwarded) and
  parses with the round-A model (lib/admin-editors.ts): anything but a 200
  with a fully valid list renders a fail-loud error panel and NO forms —
  never render invented state (a partial list is a lie).

  The create form renders EVERY PRODUCT_FIELDS input per its metadata
  (slug|brand|model|family text, price_cents|art_hue integers,
  art_variant select of the closed set, active checkbox — default CHECKED,
  paired with a hidden `active=false` companion so an UNCHECKED box still
  creates an inactive product (the D2a create DTO requires `active`; a bare
  unchecked box would submit nothing and 400 "missing field")). Hints are
  the metadata's. Writes go through the relay `app/admin/api/products`
  (one plain form; `name="action"` `value="create"` on Save).

  The relay answers 303 with a slug-only query on THIS page:
  `?saved=<product <slug>>` / `?error=<slug>`. The API's raw error text
  never enters a URL (logs/favorites surface, house rule). `?saved=` is
  echoed only when it matches the CLOSED pattern of savedKeys the round-A
  create dispatcher produces (`product <slug>` — D2a slug shape); anything
  else is ignored (an untrusted query string is never rendered).
  `?error=` maps through a Map (untrusted values can never reach an
  inherited property) with a generic fallback.

  Confirmation banner: globals.css has NO green token (CSS-01), so the
  positive signal is the lamp glow accent (same as the settings page).

  `export const dynamic = "force-dynamic"` (admin views show CURRENT DB
  state, never cached) and searchParams is a Promise in Next 15.
*/

export const metadata: Metadata = { title: "Products" };

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
 * Closed allowlist pattern for `?saved=`: the savedKeys this page's relay
 * (lib/admin-editors.ts `dispatchCreateProduct`) can produce — `product
 * <slug>` with the D2a slug shape `[a-z0-9-]{1,64}`. Only a key the
 * dispatcher chose is ever echoed; raw searchParams are never rendered.
 */
/* Closed allowlist vocabulary for `?saved=` (the keys THIS page's relays
   can redirect here with): the products relay saves `product <slug>`, and
   the pieces relay's DELETE falls back here with `piece <n>` (the delete
   form carries no product context — review finding: the fallback banner
   used to be dropped). Anything else renders no banner. */
const savedKeyPattern = /^(product [a-z0-9-]{1,64}|piece [0-9]+)$/;

/** The shared text-input classes (mirrors the settings page). */
const inputClasses =
  "border border-sand bg-bone px-3 py-2 text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow";

/** The shared Save-button classes (mirrors the settings page). */
const saveButtonClasses =
  "border border-charcoal px-5 py-2 text-sm text-charcoal transition-colors duration-200 hover:border-glow hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow";

/**
 * Render one create-form control from its PRODUCT_FIELDS metadata. `family`
 * is NOT required (the D2a create rule allows an empty family — the field
 * must be SENT, which a text input always is). The integer hints (min/max)
 * mirror the D2a truths; the API remains the judge.
 */
function createInput(meta: ProductFieldMeta): ReactNode {
  const id = `create-${meta.key}`;
  const hintId = `${id}-hint`;
  if (meta.input === "select") {
    return (
      <select
        id={id}
        name={meta.key}
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
      <>
        <input
          id={id}
          name={meta.key}
          type="checkbox"
          defaultChecked
          value="true"
          aria-describedby={hintId}
          className="h-4 w-4 border border-sand accent-glow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
        />
        {/* Hidden companion (see the header): an unchecked box must still
            submit `active=false` so the create DTO is complete — the PATCH
            form deliberately has no companion. */}
        <input type="hidden" name={meta.key} value="false" />
      </>
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
        required
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
      required={meta.key !== "family"}
      aria-describedby={hintId}
      className={inputClasses}
    />
  );
}

interface AdminProductsPageProps {
  searchParams: Promise<{ saved?: string; error?: string }>;
}

export default async function AdminProductsPage({
  searchParams,
}: AdminProductsPageProps) {
  // Session gate (whoami-confirmed; redirects when missing/expired) plus the
  // raw cookie value for the API read.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  const fetched = await adminGet(apiUrl, "/api/admin/products", sessionValue);
  const rows = fetched.status === 200 ? parseAdminProducts(fetched.json) : null;

  const { saved, error } = await searchParams;
  const savedMessage =
    saved !== undefined && savedKeyPattern.test(saved)
      ? `Saved ${saved} — the storefront's 60-second content lease expires; the next request serves the last-good value while the fresh one regenerates in the background.`
      : null;
  const errorMessage =
    error === undefined ? null : (errorMessages.get(error) ?? "Nothing saved.");

  // Admin display only: the storefront prices through its own configured
  // currency resolution (lib/config.ts); this column is operator context.
  const currency = process.env.NEXT_PUBLIC_CURRENCY?.trim() || "HKD";

  if (rows === null) {
    // Fail loud, render NOTHING else: forms over unknown state are lies.
    return (
      <section className="flex flex-col gap-4">
        <h1 className="font-serif text-2xl font-normal">Products</h1>
        <p
          role="alert"
          className="border-l-4 border-glow-ember pl-4 text-lg leading-relaxed text-charcoal"
        >
          Products could not be loaded from the API — retry later.
        </p>
        <Link href="/admin" className="text-sm text-ink-soft underline">
          ← Back to admin
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-normal">Products</h1>
        <p className="text-base leading-relaxed text-ink-soft">
          Every product row (inactive ones included — they are never deleted,
          only hidden). Prices are formatted for display only; the stored
          value is always integer minor units. Click Edit to manage a
          product&apos;s copy, reference price and numbered pieces.
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

      <table className="w-full border-collapse text-sm text-charcoal">
        <thead>
          <tr className="border-b border-charcoal">
            <th className="px-3 py-2 text-left font-normal text-ink-soft">ID</th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">Slug</th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">Model</th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">Price</th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">Active</th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">
              Stock (total / reserved)
            </th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">Edit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-sand">
              <td className="px-3 py-2">{row.id}</td>
              <td className="px-3 py-2">{row.slug}</td>
              <td className="px-3 py-2">
                {row.brand} · {row.model}
              </td>
              {/* Admin display only: formatMoney renders the configured
                  currency for operator context; the API stores and serves
                  integer minor units. */}
              <td className="px-3 py-2">{formatMoney(row.price_cents, currency)}</td>
              <td className="px-3 py-2">{row.active ? "yes" : "no"}</td>
              <td className="px-3 py-2">
                {row.stock_total} / {row.stock_reserved}
              </td>
              <td className="px-3 py-2">
                <Link
                  href={`/admin/products/${row.id}`}
                  className="underline transition-colors duration-200 hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
                >
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        method="post"
        action="/admin/api/products"
        className="flex max-w-xl flex-col gap-4 border-t border-sand pt-6"
      >
        <h2 className="font-serif text-xl font-normal">Create product</h2>
        <p className="text-sm text-ink-soft">
          Every field is sent; the API validates (slug shape, non-empty
          brand/model, price ≥ 0, art variant, hue 0–359) and reports
          duplicates as already-exists.
        </p>
        {PRODUCT_FIELDS.createRequired.map((meta) => {
          const id = `create-${meta.key}`;
          const hintId = `${id}-hint`;
          return (
            <div key={meta.key} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-base text-charcoal">
                {meta.label}
              </label>
              {createInput(meta)}
              <p id={hintId} className="text-sm text-ink-soft">
                {meta.hint}
              </p>
            </div>
          );
        })}
        <div>
          <button type="submit" name="action" value="create" className={saveButtonClasses}>
            Save
          </button>
        </div>
      </form>

      <Link href="/admin" className="text-sm text-ink-soft underline">
        ← Back to admin
      </Link>
    </section>
  );
}

import { relayRedirect, sameOriginGuard } from "../../../../lib/admin-relay.ts";
import {
  DEFAULT_SITE_CONTENT_LOCALES,
  PRODUCT_CONTENT_FIELDS,
  dispatchUpsertProductContent,
} from "../../../../lib/admin-editors.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../lib/admin-session.ts";

/*
  Product-content relay (D2b task 4, ADMIN-01): the plain-HTML-form target
  of the per-locale/per-field copy forms on /admin/products/{id}. Same relay
  architecture as the settings relay (lib/admin-client.ts): the browser
  never calls the Rust admin API — `dispatchUpsertProductContent` ->
  `adminMutate` forwards the session cookie AND the X-Requested-With CSRF
  header, `requireAdminSession` (whoami-gated) confirms the session first.
  One form = one (product, locale, field) copy row, upserted.

  Result -> 303 with a RELATIVE Location carrying a slug-only query on the
  product's own detail page (`/admin/products/{product_id}?saved=<savedKey>`
  / `?error=<slug>` — the dispatcher's savedKey names the row:
  `<product_id> <locale> <field>`). Raw API error text never enters a URL;
  session values are never logged.

  FORM VALIDATION BEFORE DISPATCH (task contract): the locale and field are
  taken from the page's HIDDEN inputs and must come from the CLOSED sets —
  DEFAULT_SITE_CONTENT_LOCALES (the documented pair; the deployment's
  LOCALES can replace it, see the constant's note in lib/admin-editors.ts)
  and PRODUCT_CONTENT_FIELDS. A value outside them is a FORM BUG (no honest
  form can submit one), so it is rejected here with `invalid` and without
  touching the API; the API's own validator remains the judge regardless
  (defense in depth — a hand-crafted request that somehow passed would be
  caught there). The VALUE is passed through untouched: blank is NOT
  pre-judged — the API 400s an empty value ("no clearing"), which maps to
  `invalid` honestly.

  CSRF (web leg): `sameOriginGuard` rejects cross-site browser form POSTs
  (documented limitations in lib/admin-relay.ts); no `Origin` passes.

  A missing/unknown `action` falls back to "save" (single-action relay; the
  browser submits the form on Enter without clicking any button).
*/

/** Served per request: this route mutates admin state, never cache it. */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guarded = sameOriginGuard(request);
  if (guarded !== null) return guarded;

  // Confirm the session BEFORE reading the form (whoami; redirects when
  // missing/expired). The raw value is then only used to forward.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  const form = (await request.formData().catch(() => null)) ?? new FormData();
  const rawProductId = form.get("product_id");
  const locale = form.get("locale");
  const field = form.get("field");
  const rawValue = form.get("value");

  // The product_id is BOTH the mutation target and the redirect context: a
  // non-integer cannot be dispatched nor named in the URL -> the product
  // list with `invalid`, without touching the API (form bug).
  const productId = typeof rawProductId === "string" ? Number(rawProductId) : NaN;
  if (!Number.isSafeInteger(productId) || productId < 1) {
    return relayRedirect("/admin/products?error=invalid");
  }

  // Closed-set pre-check (see the header): locale/field come from the
  // page's hidden inputs; anything else is a form bug -> `invalid` on the
  // product's page, without touching the API.
  if (
    typeof locale !== "string" ||
    !(DEFAULT_SITE_CONTENT_LOCALES as readonly string[]).includes(locale) ||
    typeof field !== "string" ||
    !(PRODUCT_CONTENT_FIELDS as readonly string[]).includes(field)
  ) {
    return relayRedirect(`/admin/products/${productId}?error=invalid`);
  }

  const value = typeof rawValue === "string" ? rawValue : "";

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  const { slug, savedKey } = await dispatchUpsertProductContent(
    apiUrl,
    { product_id: productId, locale, field, value },
    sessionValue,
  );

  if (slug === "saved") {
    return relayRedirect(
      `/admin/products/${productId}?saved=${encodeURIComponent(savedKey ?? `${productId} ${locale} ${field}`)}`,
    );
  }
  return relayRedirect(`/admin/products/${productId}?error=${slug}`);
}

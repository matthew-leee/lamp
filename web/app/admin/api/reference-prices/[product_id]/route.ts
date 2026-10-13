import { relayRedirect, sameOriginGuard } from "../../../../../lib/admin-relay.ts";
import {
  dispatchDeleteReferencePrice,
  dispatchUpsertReferencePrice,
  type ReferencePriceInput,
} from "../../../../../lib/admin-editors.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../../lib/admin-session.ts";

/*
  Reference-price relay (D2b task 4, ADMIN-01): the plain-HTML-form target
  of the reference-price form on /admin/products/{product_id} — one form,
  two buttons (`action=save` upserts the product's single verified
  reference range, `action=delete` removes it = verification pending
  again). Same relay architecture as the settings relay
  (lib/admin-client.ts): `dispatchUpsertReferencePrice` /
  `dispatchDeleteReferencePrice` -> `adminMutate` forwards the session
  cookie AND the X-Requested-With CSRF header; `requireAdminSession`
  (whoami-gated) confirms the session first. The API re-validates
  everything (min/max >= 0 and min <= max, non-empty source_name, absolute
  http(s) source_url with host[:port] and no userinfo, checked_on a real
  YYYY-MM-DD date). DELETE 404 maps to `notfound` — NOT an idempotent
  save: the page only renders the button when a row exists.

  Result -> 303 with a RELATIVE Location carrying a slug-only query on the
  product's own detail page (`/admin/products/{product_id}?saved=...` /
  `?error=...`; the dispatcher's savedKey is
  `reference price for product <product_id>`). Raw API error text never
  enters a URL; session values are never logged.

  NUMBER FIELDS (the documented pick, task 4): each number is parsed with
  Number(); anything blank or non-integral is sent as the EMPTY STRING ""
  so serde rejects it as a non-integer (400 -> `invalid`). Deliberate:
  fabricating 0 would be a value verdict we have no right to make, and
  omitting the key would 400 "invalid JSON" just as honestly but with a
  more confusing wire shape. Negatives parse fine and are left to the API's
  own >= 0 / min <= max verdict. The strings (source_name, source_url,
  checked_on) are passed through untouched — blank reaches the API and
  400s honestly. Only TYPE SHAPE is normalized here; values stay the API's
  to judge.

  CSRF (web leg): `sameOriginGuard` rejects cross-site browser form POSTs
  (documented limitations in lib/admin-relay.ts); no `Origin` passes.

  A missing/unknown `action` falls back to "save" (the non-destructive
  default, mirroring the settings relay; the browser's implicit submission
  clicks the first submit button — Save — anyway).
*/

/** Served per request: this route mutates admin state, never cache it. */
export const dynamic = "force-dynamic";

/**
 * One form number field: the integer when it parses, else "" (see the
 * NUMBER FIELDS note — the empty STRING is what serde 400s).
 */
function numberField(form: FormData, key: string): number | string {
  const raw = form.get(key);
  const text = typeof raw === "string" ? raw.trim() : "";
  const parsed = Number(text);
  return text !== "" && Number.isSafeInteger(parsed) ? parsed : "";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ product_id: string }> },
): Promise<Response> {
  const guarded = sameOriginGuard(request);
  if (guarded !== null) return guarded;

  // Confirm the session BEFORE reading the form (whoami; redirects when
  // missing/expired). The raw value is then only used to forward.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  const { product_id: rawProductId } = await params;
  // The product_id is BOTH the mutation target and the redirect context: a
  // non-integer cannot be dispatched nor named in the URL -> the product
  // list with `invalid`, without touching the API (form bug).
  const productId = Number(rawProductId);
  if (!Number.isSafeInteger(productId) || productId < 1) {
    return relayRedirect("/admin/products?error=invalid");
  }

  const form = (await request.formData().catch(() => null)) ?? new FormData();
  const rawAction = form.get("action");
  const deleting = rawAction === "delete";
  const rawName = form.get("source_name");
  const rawUrl = form.get("source_url");
  const rawChecked = form.get("checked_on");

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  const result = deleting
    ? await dispatchDeleteReferencePrice(apiUrl, productId, sessionValue)
    : await dispatchUpsertReferencePrice(
        apiUrl,
        productId,
        {
          min_price_cents: numberField(form, "min_price_cents"),
          max_price_cents: numberField(form, "max_price_cents"),
          source_name: typeof rawName === "string" ? rawName : "",
          source_url: typeof rawUrl === "string" ? rawUrl : "",
          checked_on: typeof rawChecked === "string" ? rawChecked : "",
          // Deliberate wire-level type escape (documented in the header):
          // an unparseable number travels as the JSON string "" so the
          // API's serde 400s it as not-an-integer. `adminMutate` forwards
          // the object untouched and JSON.stringify keeps the string.
        } as unknown as ReferencePriceInput,
        sessionValue,
      );
  const { slug, savedKey } = result;

  if (slug === "saved") {
    return relayRedirect(
      `/admin/products/${productId}?saved=${encodeURIComponent(savedKey ?? `reference price for product ${productId}`)}`,
    );
  }
  return relayRedirect(`/admin/products/${productId}?error=${slug}`);
}

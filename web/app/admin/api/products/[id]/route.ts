import { relayRedirect, sameOriginGuard } from "../../../../../lib/admin-relay.ts";
import {
  dispatchUpdateProduct,
  type CreateProductInput,
} from "../../../../../lib/admin-editors.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../../lib/admin-session.ts";

/*
  Product patch relay (D2b task 4, ADMIN-01): the plain-HTML-form target of
  the edit form on /admin/products/{id}. Same relay architecture as the
  settings relay (lib/admin-client.ts): the browser never calls the Rust
  admin API — `dispatchUpdateProduct` -> `adminMutate` forwards the session
  cookie AND adds the X-Requested-With CSRF header, and `requireAdminSession`
  (whoami-gated) confirms the session BEFORE any mutation. The API
  re-validates everything (the patch 400s empty slug/brand/model, bad
  art_variant/hue, price < 0, and a patch with NO keys): the form hints are
  UX, not validation. 404 -> `notfound` (missing id), 409 -> `conflict`
  (slug taken).

  Result -> 303 with a RELATIVE Location carrying a slug-only query on the
  page that owns the form (the product's own detail page, so the operator
  lands back at the form they filled): `/admin/products/{id}?saved=<savedKey>`
  or `/admin/products/{id}?error=<slug>`. Raw API error text never enters a
  URL; session values are never logged.

  FORM MAPPING (MIRROR of ../route.ts — the patch contract is "the same
  field mapping as create"): driven by PRODUCT_FIELDS' metadata; text
  fields are sent as typed (blank -> the API 400s empty slug/brand/model
  honestly), a BLANK number is omitted (unchanged), an unchecked `active`
  is omitted (unchanged — the edit form has NO hidden companion, unlike the
  create form: an unchecked box must NOT mean "deactivate"), and a
  non-integral number is forwarded as its raw STRING so serde 400s it
  (JSON NaN would serialize as null = "unchanged", a silent lie). Nothing
  here pre-judges values: the API is the judge.

  CSRF (web leg): `sameOriginGuard` rejects cross-site browser form POSTs
  (documented limitations in lib/admin-relay.ts); no `Origin` passes.

  A missing/unknown `action` falls back to "save" (single-action relay; the
  browser submits the form on Enter without clicking any button).
*/

/** Served per request: this route mutates admin state, never cache it. */
export const dynamic = "force-dynamic";

/**
 * A partial product body. The `| string` escape is the deliberate
 * non-integral-number passthrough (serde 400s it -> "invalid").
 */
type ProductFormBody = {
  [K in keyof CreateProductInput]?: CreateProductInput[K] | string;
};

/** A text field: the typed string, or undefined when the form lacked it. */
function textField(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  return typeof raw === "string" ? raw : undefined;
}

/**
 * A number field: the integer, undefined when blank (omit = unchanged), or
 * the raw string when non-integral (serde 400s it — see the comment above).
 */
function numberField(form: FormData, key: string): number | string | undefined {
  const raw = form.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const text = raw.trim();
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : text;
}

/** `active`: absent (unchecked) -> omit = unchanged; else a boolean. */
function activeField(form: FormData): boolean | undefined {
  const raw = form.get("active");
  if (typeof raw !== "string") return undefined;
  return raw !== "false";
}

/** Map the product form to a patch body (see the mapping comment). */
function productBodyFrom(form: FormData): ProductFormBody {
  const body: ProductFormBody = {};
  const slug = textField(form, "slug");
  if (slug !== undefined) body.slug = slug;
  const brand = textField(form, "brand");
  if (brand !== undefined) body.brand = brand;
  const model = textField(form, "model");
  if (model !== undefined) body.model = model;
  const priceCents = numberField(form, "price_cents");
  if (priceCents !== undefined) body.price_cents = priceCents;
  const family = textField(form, "family");
  if (family !== undefined) body.family = family;
  const artVariant = textField(form, "art_variant");
  if (artVariant !== undefined) body.art_variant = artVariant;
  const artHue = numberField(form, "art_hue");
  if (artHue !== undefined) body.art_hue = artHue;
  const active = activeField(form);
  if (active !== undefined) body.active = active;
  return body;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guarded = sameOriginGuard(request);
  if (guarded !== null) return guarded;

  // Confirm the session BEFORE reading the form (whoami; redirects when
  // missing/expired). The raw value is then only used to forward.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  const { id: rawId } = await params;
  // The id is BOTH the mutation target and the redirect context: an id that
  // is not a positive integer cannot be dispatched (the dispatcher builds
  // the API path from it) nor named in the redirect URL. A hand-rolled
  // request with a junk id is a form bug, not a value to judge -> the
  // product list with `invalid`, without touching the API.
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) {
    return relayRedirect("/admin/products?error=invalid");
  }

  const form = (await request.formData().catch(() => null)) ?? new FormData();
  const patch = productBodyFrom(form);

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  // The cast is the documented passthrough: non-integral numbers ride as
  // strings and JSON.stringify drops nothing the mapper omitted. A patch
  // with ZERO keys reaches the API as `{}` and 400s ("no fields to
  // update") -> `invalid` — honest, never a silent "saved".
  const { slug, savedKey } = await dispatchUpdateProduct(
    apiUrl,
    id,
    patch as Partial<CreateProductInput>,
    sessionValue,
  );

  if (slug === "saved") {
    return relayRedirect(
      `/admin/products/${id}?saved=${encodeURIComponent(savedKey ?? `product ${id}`)}`,
    );
  }
  return relayRedirect(`/admin/products/${id}?error=${slug}`);
}

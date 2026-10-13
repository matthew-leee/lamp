import { relayRedirect, sameOriginGuard } from "../../../../lib/admin-relay.ts";
import {
  dispatchCreateProduct,
  type CreateProductInput,
} from "../../../../lib/admin-editors.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../lib/admin-session.ts";

/*
  Product create relay (D2b task 4, ADMIN-01): the plain-HTML-form target of
  the create form on /admin/products. The browser NEVER calls the Rust API
  directly for admin (lib/admin-client.ts architecture): this route relays
  the form POST server-side — `dispatchCreateProduct` ->
  `adminMutate` forwards the session cookie AND adds the X-Requested-With
  CSRF header — and the session is CONFIRMED here by `requireAdminSession`
  (whoami-gated) before any mutation is attempted. The API re-validates
  everything (slug shape, non-empty brand/model, price >= 0, art_variant in
  the closed set, art_hue 0-359): the page's field hints are UX, NOT
  validation (defense in depth). 409 "slug already in use" -> `conflict`.

  Result -> 303 with a RELATIVE Location carrying a slug-only query on the
  page that owns the form: `/admin/products?saved=<savedKey>` (the
  dispatcher's own `product <slug>`) or `/admin/products?error=<slug>`. The
  API's raw error strings never enter a URL (query params are a
  logs/favorites surface, house rule). SESSION VALUES are never logged.

  FORM MAPPING (MIRROR of ./[id]/route.ts — the patch contract is "the same
  field mapping as create", task 4): driven by PRODUCT_FIELDS' metadata.
  Deliberately NOT pre-judging values (the API judges):
  - text fields are sent AS TYPED whenever the form carried them (blank is
    sent BLANK — the API 400s an empty slug/brand/model honestly; a field
    absent from the form is omitted entirely);
  - number fields are sent as integers only when non-blank and integral; a
    blank number is OMITTED (the API 400s the missing required field). A
    non-integral number is forwarded as its raw STRING so serde 400s it —
    a Number() NaN would serialize as JSON null, which a PATCH reads as
    "unchanged" (a silent lie);
  - active: a present value becomes a boolean. The create form pairs the
    checkbox with a hidden `active=false` companion (the D2a create DTO
    REQUIRES active), so unchecking still creates an inactive product
    instead of a missing-field 400; on the PATCH form there is no companion
    and an unchecked box is simply absent = unchanged.

  CSRF (web leg, same as the login/logout relays): `sameOriginGuard`
  rejects cross-site browser form POSTs (authority-normalized,
  scheme-agnostic; documented limitations in lib/admin-relay.ts). A request
  without `Origin` (curl, tests) passes.

  A missing/unknown `action` falls back to "create" — this relay has
  exactly one action and the browser submits the form on Enter without
  clicking any button (mirrors the settings relay's fallback).
*/

/** Served per request: this route mutates admin state, never cache it. */
export const dynamic = "force-dynamic";

/**
 * A partial product body. The `| string` escape is the deliberate
 * non-integral-number passthrough above (serde 400s it -> "invalid").
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
 * A number field: the integer, undefined when blank (omit), or the raw
 * string when non-integral (serde 400s it — see the mapping comment).
 */
function numberField(form: FormData, key: string): number | string | undefined {
  const raw = form.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const text = raw.trim();
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : text;
}

/** `active`: absent -> omit; otherwise a boolean ("false" is false). */
function activeField(form: FormData): boolean | undefined {
  const raw = form.get("active");
  if (typeof raw !== "string") return undefined;
  return raw !== "false";
}

/** Map the product form to a create/patch body (see the mapping comment). */
function productBodyFrom(form: FormData): ProductFormBody {
  const body: ProductFormBody = {};
  // TEXT_FIELDS / INTEGER_FIELDS / checkbox follow PRODUCT_FIELDS'
  // metadata: slug|brand|model|family are text, price_cents|art_hue are
  // integers, art_variant is a select (a plain string here — the API
  // judges the closed set), active is the checkbox.
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

export async function POST(request: Request): Promise<Response> {
  const guarded = sameOriginGuard(request);
  if (guarded !== null) return guarded;

  // Confirm the session BEFORE reading the form (whoami; redirects when
  // missing/expired). The raw value is then only used to forward.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  const form = (await request.formData().catch(() => null)) ?? new FormData();
  const body = productBodyFrom(form);

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  // The DTO requires EVERY field: omitted keys are exactly what the API
  // 400s ("missing field ...") — honest "invalid", no invented values. The
  // cast reflects productBody's undefined-omission contract (the same
  // shape the PATCH path sends on purpose).
  const { slug, savedKey } = await dispatchCreateProduct(
    apiUrl,
    body as CreateProductInput,
    sessionValue,
  );

  if (slug === "saved") {
    return relayRedirect(
      `/admin/products?saved=${encodeURIComponent(savedKey ?? "product")}`,
    );
  }
  return relayRedirect(`/admin/products?error=${slug}`);
}

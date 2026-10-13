import { relayRedirect, sameOriginGuard } from "../../../../lib/admin-relay.ts";
import { dispatchCreatePiece } from "../../../../lib/admin-editors.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../lib/admin-session.ts";

/*
  Piece create relay (D2b task 4, ADMIN-01): the plain-HTML-form target of
  the "add piece" form on /admin/products/{product_id} (piece_no input +
  a hidden product_id = the product being viewed). Same relay architecture
  as the settings relay (lib/admin-client.ts): `dispatchCreatePiece` ->
  `adminMutate` forwards the session cookie AND the X-Requested-With CSRF
  header; `requireAdminSession` (whoami-gated) confirms the session first.
  The API re-validates (piece_no/product_id >= 1; 404 "product not found";
  409 "piece_no already exists" -> `conflict`).

  Result -> 303 with a RELATIVE Location carrying a slug-only query on the
  product's detail page (`/admin/products/{product_id}?saved=piece <piece_no>`
  / `?error=...`). Raw API error text never enters a URL; session values
  are never logged.

  FORM VALIDATION BEFORE DISPATCH: piece_no and product_id are integers by
  form shape (number inputs + hidden). A non-integer cannot be dispatched
  (the dispatcher takes numbers) and — for product_id — cannot name the
  redirect page either, so it is a form bug: `invalid` without touching the
  API (product_id first — it decides the redirect target; then piece_no).
  Values (>= 1, existence, uniqueness) stay the API's verdict.

  CSRF (web leg): `sameOriginGuard` rejects cross-site browser form POSTs
  (documented limitations in lib/admin-relay.ts); no `Origin` passes.

  A missing/unknown `action` falls back to "create" (single-action relay;
  the browser submits the form on Enter without clicking any button).
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
  const rawPieceNo = form.get("piece_no");

  // product_id first: it is the mutation target AND the redirect context.
  const productId = typeof rawProductId === "string" ? Number(rawProductId) : NaN;
  if (!Number.isSafeInteger(productId) || productId < 1) {
    return relayRedirect("/admin/products?error=invalid");
  }
  const pieceNo = typeof rawPieceNo === "string" ? Number(rawPieceNo) : NaN;
  if (!Number.isSafeInteger(pieceNo) || pieceNo < 1) {
    return relayRedirect(`/admin/products/${productId}?error=invalid`);
  }

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  const { slug, savedKey } = await dispatchCreatePiece(
    apiUrl,
    { piece_no: pieceNo, product_id: productId },
    sessionValue,
  );

  if (slug === "saved") {
    return relayRedirect(
      `/admin/products/${productId}?saved=${encodeURIComponent(savedKey ?? `piece ${pieceNo}`)}`,
    );
  }
  return relayRedirect(`/admin/products/${productId}?error=${slug}`);
}

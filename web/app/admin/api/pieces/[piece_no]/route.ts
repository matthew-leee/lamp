import { relayRedirect, sameOriginGuard } from "../../../../../lib/admin-relay.ts";
import {
  dispatchDeletePiece,
  dispatchReassignPiece,
} from "../../../../../lib/admin-editors.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../../lib/admin-session.ts";

/*
  Piece reassign/delete relay (D2b task 4, ADMIN-01): the plain-HTML-form
  target of the two per-piece forms on /admin/products/{product_id} —
  `action=reassign` moves the piece to the product named by the form's
  `product_id` number input, `action=delete` removes the piece number. Same
  relay architecture as the settings relay (lib/admin-client.ts):
  `dispatchReassignPiece` / `dispatchDeletePiece` -> `adminMutate` forwards
  the session cookie AND the X-Requested-With CSRF header;
  `requireAdminSession` (whoami-gated) confirms the session first. The API
  re-validates (piece_no/product_id >= 1; 404 piece/product not found;
  409 piece_no exists). DELETE 404 maps to `notfound` — the page only
  renders the button for pieces it is showing.

  REDIRECT TARGETS (the documented pieces-delete nuance, task 4): the
  reassign form's `product_id` is the NEW product — it is the mutation
  target AND the redirect context, so reassign lands on
  `/admin/products/{form product_id}`. The DELETE form deliberately
  carries NO product_id: after the delete there is no piece row to return
  to, and the only `product_id` field on the page is the reassign TARGET —
  reusing it for delete would be misleading. So when `product_id` is
  absent (the page's delete form) the relay falls back to the product LIST
  (`/admin/products`), which always shows the outcome; when a form does
  carry one (defensively supported), it is honoured. Slugs only in the
  query (`?saved=piece <piece_no>` / `?error=<slug>`); raw API error text
  never enters a URL; session values are never logged.

  FORM VALIDATION BEFORE DISPATCH: piece_no (URL) and product_id (form)
  must be positive integers to be dispatchable at all; a junk value is a
  form bug -> `invalid` without touching the API (product_id decides the
  redirect base, so it is read first). Values stay the API's verdict.

  ACTION FALLBACK: unlike the single-action relays there is NO harmless
  default here — reassign MOVES a piece and delete REMOVES it — so a
  missing/unknown `action` is a form bug -> `invalid` without dispatching
  (the page's two buttons always carry their action; the browser's implicit
  submission clicks the first submit button, which names `reassign`).
*/

/** Served per request: this route mutates admin state, never cache it. */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ piece_no: string }> },
): Promise<Response> {
  const guarded = sameOriginGuard(request);
  if (guarded !== null) return guarded;

  // Confirm the session BEFORE reading the form (whoami; redirects when
  // missing/expired). The raw value is then only used to forward.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  const { piece_no: rawPieceNo } = await params;
  const pieceNo = Number(rawPieceNo);
  if (!Number.isSafeInteger(pieceNo) || pieceNo < 1) {
    // A junk piece_no cannot be dispatched (the dispatcher builds the API
    // path from it) nor named in a product context -> the list with
    // `invalid`, without touching the API.
    return relayRedirect("/admin/products?error=invalid");
  }

  const form = (await request.formData().catch(() => null)) ?? new FormData();
  const rawProductId = form.get("product_id");
  const productId = typeof rawProductId === "string" ? Number(rawProductId) : NaN;
  const hasProduct = Number.isSafeInteger(productId) && productId >= 1;
  // The redirect base: the form's product page when it names a product,
  // else the product list (the delete form carries no product_id — see the
  // header's redirect note).
  const base = hasProduct ? `/admin/products/${productId}` : "/admin/products";

  const rawAction = form.get("action");
  if (rawAction === "reassign") {
    // Reassign NEEDS a product: it is both the mutation input and the
    // redirect context. Without one the relay can neither dispatch nor
    // name the page -> `invalid` on the base, without touching the API.
    if (!hasProduct) {
      return relayRedirect(`${base}?error=invalid`);
    }
    // Same static env access as lib/availability.ts (inlined at build).
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
    const { slug, savedKey } = await dispatchReassignPiece(
      apiUrl,
      pieceNo,
      productId,
      sessionValue,
    );
    if (slug === "saved") {
      return relayRedirect(
        `${base}?saved=${encodeURIComponent(savedKey ?? `piece ${pieceNo}`)}`,
      );
    }
    return relayRedirect(`${base}?error=${slug}`);
  }

  if (rawAction === "delete") {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
    const { slug, savedKey } = await dispatchDeletePiece(
      apiUrl,
      pieceNo,
      sessionValue,
    );
    if (slug === "saved") {
      return relayRedirect(
        `${base}?saved=${encodeURIComponent(savedKey ?? `piece ${pieceNo}`)}`,
      );
    }
    return relayRedirect(`${base}?error=${slug}`);
  }

  // Missing/unknown action: a form bug (both actions are consequential) —
  // never guess between moving and removing a piece.
  return relayRedirect(`${base}?error=invalid`);
}

import { relayRedirect, sameOriginGuard } from "../../../../../lib/admin-relay.ts";
import {
  dispatchSettingAction,
  type SettingAction,
} from "../../../../../lib/admin-settings.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../../lib/admin-session.ts";

/*
  Settings mutation relay (D2b task 3, ADMIN-01): one plain-HTML-form target
  per settings key, outside the (authed) group like the other relays. The
  browser NEVER calls the Rust API directly for admin (see
  lib/admin-client.ts for the relay architecture): this route relays the
  form POST server-side — `adminMutate` forwards the session cookie AND adds
  the X-Requested-With header the API's CSRF middleware requires — and the
  session is CONFIRMED here by `requireAdminSession` (whoami-gated; it works
  in route handlers: cookies() + redirect()) before any mutation is
  attempted. The API then re-validates everything (key whitelist, required
  keys never empty, ISO currency, secret-looking keys): the page's field
  hints are UX, NOT validation (defense in depth).

  Dispatch (lib/admin-settings.ts `dispatchSettingAction`): action
  save/off -> `PUT /api/admin/settings/{key}` `{"value": ...}` (off sends
  the EMPTY value = presence-wins explicit OFF; only ever reached for
  OPTIONAL keys — the page never renders the button for required keys, and
  the API would 400 an empty required value anyway, which maps to the
  `invalid` slug — honest), revert -> `DELETE /api/admin/settings/{key}`
  (no body: the D2a delete handler extracts none). The KEY comes from the
  URL path and is caller-controlled; it is URL-encoded into the API path and
  dies at the API's whitelist with 400 (`invalid`) if smuggled. Keys are
  from a closed set and echo fine (the page renders them); SESSION VALUES
  are never logged.

  Result -> `relayActionSlug` -> 303 with a RELATIVE Location carrying a
  slug-only query: `/admin/settings?saved=<key>` or
  `/admin/settings?error=<slug>`. The API's raw error strings never enter a
  URL (query params are a logs/favorites surface, house rule). DELETE 404
  "settings override not found" maps to SAVED (idempotent revert: already at
  the env default).

  CSRF (web leg, same as the login/logout relays): `sameOriginGuard`
  (lib/admin-relay.ts) rejects cross-site browser form POSTs —
  authority-normalized, scheme-agnostic, documented limitations there. A
  request without `Origin` (curl, tests) passes.

  A missing/unknown `action` falls back to "save" (the browser submits a
  form on Enter in the value input WITHOUT clicking any button).
*/

/** Served per request: this route mutates admin state, never cache it. */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const guarded = sameOriginGuard(request);
  if (guarded !== null) return guarded;

  // Confirm the session BEFORE reading the form (whoami; redirects when
  // missing/expired). The raw value is then only used to forward.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  const { key } = await params;
  const form = await request.formData().catch(() => null);
  const rawAction = form?.get("action");
  const rawValue = form?.get("value");
  const action: SettingAction =
    rawAction === "off" || rawAction === "revert" ? rawAction : "save";
  const value = typeof rawValue === "string" ? rawValue : "";

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  const { slug, savedKey } = await dispatchSettingAction(
    apiUrl,
    key,
    action,
    value,
    sessionValue,
  );

  if (slug === "saved") {
    return relayRedirect(
      `/admin/settings?saved=${encodeURIComponent(savedKey ?? key)}`,
    );
  }
  return relayRedirect(`/admin/settings?error=${slug}`);
}

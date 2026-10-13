import {
  adminLogin,
  loginErrorSlug,
} from "../../../../lib/admin-client.ts";
import { relayRedirect, sameOriginGuard } from "../../../../lib/admin-relay.ts";
import { setAdminSessionCookie } from "../../../../lib/admin-session.ts";

/*
  Web login relay (D2b, ADMIN-01).

  The browser NEVER calls the Rust API directly for admin: this route
  relays the plain HTML form POST to `POST /api/admin/login` server-side
  (adding the X-Requested-With header the API's CSRF middleware requires),
  parses the API's Set-Cookie, re-sets the SAME session cookie on the WEB
  response (lib/admin-session.ts) and answers 303. The browser then presents
  `admin_session` to the web host and admin server components forward it to
  the API (session forwarding). No authored client JS, zero CORS.

  RELATIVE Location (review finding 1): the 303 target must resolve against
  whatever origin the browser actually used. An absolute URL derived from
  `request.url` binds the redirect to Next's listen host — NextURL
  normalizes loopback addresses to `localhost` (a 127.0.0.1 visitor would be
  bounced to localhost and lose the just-set cookie), and behind a reverse
  proxy it would leak the internal origin. `Location: /admin` (relative) is
  resolved by the browser (RFC 9110 §10.1.2) and is host-stable everywhere.

  CSRF posture (review finding 7, corrected): the API's X-Requested-With
  guard protects the API's own routes from BROWSER cross-site calls; the
  relay adds the header on every server-side call, so it is NOT browser-side
  protection here. The actual legs are: (a) login requires valid API
  credentials — login-CSRF can only force the victim INTO the attacker's
  own session, a residual risk accepted under the single-operator threat
  model (revisit at M3 if admin goes multi-user); (b) `sameOriginGuard`
  (lib/admin-relay.ts) rejects cross-site browser form POSTs —
  authority-normalized, scheme-agnostic, documented limitations there.

  Errors map to SLUGS only in the redirect query (loginErrorSlug):
  the API's raw error strings never appear in a URL (query params are a
  logs/favorites surface). Credential verdicts map to invalid/form — the
  ONLY strings that may say "wrong password"; every other failure —
  busy, not-configured/not-ready, database down/unconfigured,
  XRW-missing (a relay bug, not a verdict), unreachable,
  200-without-cookie, and ANY UNKNOWN string — maps to retry-later
  guidance (busy/notready/network): never a credential verdict when
  nothing was judged.
*/

/** Served per request: login mints/reads a credential, never cache it. */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guarded = sameOriginGuard(request);
  if (guarded !== null) return guarded;

  const form = await request.formData().catch(() => null);
  const rawUser = form?.get("username");
  const rawPass = form?.get("password");
  const username = typeof rawUser === "string" ? rawUser : "";
  const password = typeof rawPass === "string" ? rawPass : "";

  // Blank fields are a FORM error: skip the API (its 400 would say the
  // same) and say so precisely instead of "invalid credentials".
  if (username.trim() === "" || password.trim() === "") {
    return relayRedirect("/admin/login?error=form");
  }

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  const result = await adminLogin(apiUrl, username, password);

  if (result.ok) {
    await setAdminSessionCookie(result.cookie);
    return relayRedirect("/admin");
  }

  // Never render the API's raw error string in the redirect URL — slugs only.
  return relayRedirect(`/admin/login?error=${loginErrorSlug(result.error)}`);
}
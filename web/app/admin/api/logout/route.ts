import { relayRedirect, sameOriginGuard } from "../../../../lib/admin-relay.ts";
import { clearAdminSessionCookie } from "../../../../lib/admin-session.ts";

/*
  Web logout relay (D2b, ADMIN-01): clears the web-host session cookie and
  redirects to the sign-in page. Stateless sessions (api/src/admin.rs) mean
  this IS the whole logout — no API endpoint exists or is needed; the cookie
  dies, and any captured token is replayable only until its own expiry
  (accepted D2a design).

  Cross-site logout CSRF (review finding 7): `sameOriginGuard`
  (lib/admin-relay.ts) rejects cross-site browser form POSTs (authority-
  normalized, scheme-agnostic — documented limitations and the proxy
  Host/Origin forwarding note live there). A request without `Origin`
  (curl, tests) passes.
*/

/** Served per request: logout mutates the cookie, never cache it. */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guarded = sameOriginGuard(request);
  if (guarded !== null) return guarded;

  await clearAdminSessionCookie();
  return relayRedirect("/admin/login");
}
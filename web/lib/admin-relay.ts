/**
 * Pure relay-route helpers for the D2b admin API relays (ADMIN-01): the
 * same-origin guard and the relative 303. Extracted from
 * app/admin/api/{login,logout}/route.ts so both relays share ONE
 * implementation and the guard is unit-testable without a Next server
 * (test/admin-relay.test.mjs). No Next imports here: these are pure
 * Request -> Response functions.
 */

/**
 * Same-origin guard for the relay form POSTs (the web-side CSRF leg).
 *
 * Semantics (review-hardened): a request with NO `Origin` header passes
 * (non-browser clients — curl, tests, server-to-server — carry no ambient
 * credentials to abuse). A request WITH `Origin` passes only when the
 * origin's AUTHORITY matches the request's `Host` authority, both
 * normalized through the same URL parser — explicit default ports are
 * stripped (Host "shop.example:443" matches Origin
 * "https://shop.example"), IPv6 spellings canonicalize, and malformed or
 * unparseable values (including the sandboxed `Origin: null`) reject.
 *
 * Deliberately scheme-agnostic, documented limitation: a route handler
 * cannot know the deployment scheme from first principles (local plain
 * HTTP vs TLS behind a proxy), so the comparison is authority-only and a
 * same-authority scheme mismatch (http vs https) passes. The CSRF threat
 * model here is CROSS-SITE posts, whose authorities always mismatch;
 * forging a same-authority http origin requires breaking TLS or owning the
 * host, which already defeats SameSite and the Secure cookie flag. A
 * reverse proxy must forward `Host` and the browser-derived `Origin`
 * consistently (M3 deployment note).
 */
export function sameOriginGuard(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (origin === null) return null;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return forbidden();
  }
  const host = request.headers.get("host");
  if (host === null) return forbidden();
  let hostUrl: URL;
  try {
    // "https://" is a parsing scaffold only: URL parsing normalizes the
    // authority (default port stripping, IPv6 canonicalization) on both
    // sides; the scheme itself is out of the comparison (see above).
    hostUrl = new URL(`https://${host}`);
  } catch {
    return forbidden();
  }
  return originUrl.host === hostUrl.host ? null : forbidden();
}

/**
 * 303 with a RELATIVE `Location` (review finding 1 from the first pass):
 * the target resolves against whatever origin the browser actually used.
 * An absolute URL derived from `request.url` would bind the redirect to
 * Next's listen host — NextURL normalizes loopback to `localhost` (a
 * 127.0.0.1 visitor would be bounced to localhost and lose the just-set
 * cookie) and would leak the internal origin behind a reverse proxy.
 */
export function relayRedirect(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}

/** Uniform 403 for the guard: no body, no redirect, nothing cached. */
function forbidden(): Response {
  return new Response(null, { status: 403 });
}
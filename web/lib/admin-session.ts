/**
 * Thin Next.js glue for the admin session cookie (ADMIN-01): the ONLY
 * module that touches `next/headers`, so lib/admin-client.ts stays pure and
 * unit-testable. See lib/admin-client.ts for the relay architecture.
 *
 * Contract with the Rust API (api/src/admin.rs session_set_cookie): the API
 * mints `admin_session=<token>; HttpOnly; SameSite=Lax; Path=/;
 * Max-Age=<ttl>[; Secure]`. The login relay re-sets the SAME cookie on the
 * web response — same name, same attributes (Secure iff the API sent it) —
 * so the browser presents it to the web host and admin server components
 * forward it back to the API (host-scoped, zero-CORS).
 *
 * Stale-cookie note: server components cannot DELETE a cookie (only route
 * handlers and server actions write responses), so a stale or expired
 * `admin_session` cannot be cleared from a component — the login relay
 * OVERWRITES it on the next successful sign-in, and logout (a route
 * handler) clears it.
 *
 * Cookie fidelity (review finding, corrected wording): the relay is
 * SEMANTIC, not byte-verbatim — this module re-emits the API-minted
 * session with the same security semantics (name `admin_session`, value,
 * Path=/, HttpOnly, SameSite=Lax, Max-Age from the API, Secure iff the API
 * sent it). Next's cookie setter normalizes casing/order and derives an
 * `Expires` date from Max-Age; neither weakens the session. The pure
 * `serializeSetCookie` round-trip in admin-client.ts pins the PARSER, not
 * the relay.
 *
 * Admin console is operator tooling: ENGLISH-ONLY, deliberately NOT
 * localized (bilingual is the storefront's customer contract, I18N-01, not
 * the admin's) — documented decision; nothing in the admin tree reads
 * lib/i18n.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_COOKIE_NAME,
  adminWhoami,
  type ParsedSetCookie,
} from "./admin-client.ts";

/** The API base URL (static env access, same as lib/availability.ts). */
function apiBase(): string | null {
  const base = process.env.NEXT_PUBLIC_API_URL?.trim();
  return base === undefined || base === "" ? null : base;
}

/** Read the session cookie value presented to the web host, or null. */
export async function getAdminSessionValue(): Promise<string | null> {
  return (await cookies()).get(ADMIN_COOKIE_NAME)?.value ?? null;
}

/** Extract `Max-Age=<seconds>` from parsed attribute tokens, if present. */
function maxAgeFromAttributes(attributes: string[]): number | undefined {
  for (const attribute of attributes) {
    const match = /^max-age=(.+)$/i.exec(attribute.trim());
    if (match === null) continue;
    const seconds = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  }
  return undefined;
}

/**
 * Re-set the API-minted session cookie on the web response (login relay).
 * Attributes are relayed per contract: Path=/, HttpOnly, SameSite=Lax,
 * Max-Age from the API's own attribute (omitted if the API ever stops
 * sending one — a session cookie), Secure iff the API sent `Secure`.
 */
export async function setAdminSessionCookie(
  parsed: ParsedSetCookie,
): Promise<void> {
  (await cookies()).set(parsed.name, parsed.value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: maxAgeFromAttributes(parsed.attributes),
    secure: parsed.attributes.some((a) => /^secure$/i.test(a.trim())),
  });
}

/**
 * Clear the session cookie (logout). The sessions are stateless
 * server-side, so this is the whole logout: no API call exists or is
 * needed.
 */
export async function clearAdminSessionCookie(): Promise<void> {
  (await cookies()).set(ADMIN_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
  });
}

/**
 * Gate an admin server component: reads the session cookie and CONFIRMS it
 * against `GET /api/admin/whoami` (the cookie alone is a bearer token; the
 * API is the authority). Redirects to /admin/login when the cookie is
 * missing, the API cannot confirm it (unhealthy counts as unauthenticated —
 * fail closed) or the API base is not configured. Returns the authenticated
 * username otherwise.
 *
 * Layouts cannot pass props to pages, so pages call this again for the
 * username; the second whoami is a cheap, no-store read.
 */
export async function requireAdminSession(): Promise<{ username: string }> {
  const value = await getAdminSessionValue();
  const apiUrl = apiBase();
  if (value === null || apiUrl === null) {
    redirect("/admin/login");
  }
  const whoami = await adminWhoami(apiUrl, value);
  if (!whoami.ok) {
    redirect("/admin/login");
  }
  return { username: whoami.username };
}

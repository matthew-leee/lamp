/**
 * Rust admin API client for the D2b admin console (ADMIN-01).
 *
 * Architecture (decided): the browser NEVER calls the Rust API directly for
 * admin. The web tier relays everything:
 *
 *   login:   form POST -> web route handler -> server-side fetch to
 *            POST /api/admin/login (adds X-Requested-With itself) ->
 *            parse the API's Set-Cookie and re-set the SAME cookie on the
 *            WEB response -> 303 redirect. The browser then presents
 *            `admin_session` to the web HOST (host-scoped cookie), which is
 *            production-correct however the API is hosted, and the admin UI
 *            is zero-CORS against the API.
 *   reads:   admin server components read the cookie (next/headers) and
 *            FORWARD it as a `Cookie` header on server-side GETs to the
 *            Rust admin API (session forwarding; see lib/admin-session.ts).
 *   writes:  web relay mutation routes (tasks 3-4) forward the cookie and
 *            add X-Requested-With.
 *
 * The API's XRW/CSRF contract is therefore left untouched.
 *
 * This module is pure/injectable (no next/headers, no next/cache): the fetch
 * is a parameter, every mapping is unit-testable without a network
 * (test/admin-client.test.mjs), and NOTHING here throws or logs secrets —
 * all failures resolve to a small typed result whose `error` strings are a
 * stable contract mapped to user-facing slugs by the web routes.
 *
 * Cross-tier contract constants: `ADMIN_COOKIE_NAME` mirrors the Rust
 * `SESSION_COOKIE_NAME` (api/src/admin.rs) and the `X-Requested-With` value
 * mirrors what the API's CSRF middleware requires. Renaming either side is
 * a breaking contract change, not a refactor.
 */

import { fetchTimeoutMs } from "./config.ts";

/* ------------------------------------------------------------------ */
/* Cross-tier contract constants                                       */
/* ------------------------------------------------------------------ */

/**
 * Session cookie name. MIRROR of the Rust `SESSION_COOKIE_NAME`
 * (api/src/admin.rs): the web tier re-sets and forwards exactly the cookie
 * the API mints. Stable cross-tier contract.
 */
export const ADMIN_COOKIE_NAME = "admin_session";

/**
 * Value for the `X-Requested-With` header every non-GET/HEAD/OPTIONS
 * `/api/admin` request requires (the API answers 403 without it). A
 * cross-site form cannot set this header, which is the API's CSRF leg.
 */
export const X_REQUESTED_WITH = "XMLHttpRequest";

/** The header name paired with {@link X_REQUESTED_WITH}. */
export const X_REQUESTED_WITH_HEADER = "X-Requested-With";

/** Fail-closed message when the API cannot be reached (network/abort). */
export const API_UNREACHABLE = "admin API unreachable; retry later";

/** Fail-closed message when a 200 login carries no usable session cookie. */
export const NO_SESSION_COOKIE = "login succeeded but no session cookie";

/** Login-redirect error slugs (app/admin/login/page.tsx renders them). */
export type LoginErrorSlug = "invalid" | "form" | "busy" | "notready" | "network";

/**
 * Map one adminLogin error string to a safe redirect slug (the ONLY layer
 * that decides what a failure MEANS to the operator):
 *
 * - credential verdicts ("invalid username or password", "username and
 *   password required") map to invalid/form — the API actually judged;
 * - everything else — 429 busy, SESSION_SECRET/rotation 503s,
 *   database not configured/unavailable, XRW missing (a relay bug, never a
 *   verdict — the API rejects XRW-less requests BEFORE judging credentials),
 *   unreachable, 200-without-cookie, and ANY UNKNOWN string — maps to
 *   busy/notready/network (retry guidance): a credential verdict on a
 *   failure nothing judged would be a lie (review finding).
 */
export function loginErrorSlug(error: string): LoginErrorSlug {
  if (error === "invalid username or password") return "invalid";
  if (error === "username and password required") return "form";
  if (error === "too many concurrent login attempts; retry shortly") return "busy";
  if (
    error === "admin sessions not configured: set SESSION_SECRET (>= 32 bytes)" ||
    error === "admin auth not ready; retry later"
  ) {
    return "notready";
  }
  // Everything else — infrastructure failures, relay bugs, and unknown
  // strings — is retry guidance, never a "wrong password" verdict.
  return "network";
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Fetch-like function (injectable for tests), mirroring catalog-client. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * One Set-Cookie line, split into name/value plus the attribute tokens
 * preserved verbatim (case, spelling and `Name=Value` form untouched).
 */
export interface ParsedSetCookie {
  name: string;
  value: string;
  /** Attribute tokens in order, e.g. ["HttpOnly", "SameSite=Lax", ...]. */
  attributes: string[];
}

/**
 * Login outcome. `error` strings are a stable contract:
 * - "invalid username or password"            (API 401, generic verdict)
 * - "username and password required"          (API 400)
 * - "missing X-Requested-With header"         (API 403)
 * - "too many concurrent login attempts; retry shortly" (API 429)
 * - any API 503 `error` body string (SESSION_SECRET/admin not configured,
 *   admin auth not ready, database unavailable)
 * - "login succeeded but no session cookie"   (fail-closed: 200 without a
 *   usable Set-Cookie — the relay must never reach the console without a
 *   session)
 * - {@link API_UNREACHABLE} (network/abort/unreadable error body)
 */
export type AdminLoginResult =
  | { ok: true; cookie: ParsedSetCookie }
  | { ok: false; error: string };

/** Whoami outcome: `username` from the session, or a mapped error string. */
export type AdminWhoamiResult =
  | { ok: true; username: string }
  | { ok: false; error: string };

/**
 * Raw result of an admin GET/relay call. NEVER throws: on network/abort the
 * status is 0 (the caller maps; 0 is not an HTTP status).
 */
export interface AdminApiResponse {
  status: number;
  json: unknown;
}

/* ------------------------------------------------------------------ */
/* Set-Cookie parsing (pure)                                           */
/* ------------------------------------------------------------------ */

/**
 * Parse one `Set-Cookie` line into name/value + attribute tokens.
 *
 * The first `;`-segment is `name=value` (split on the FIRST `=` so quoted
 * or `=`-bearing values survive); every later segment is an attribute token
 * preserved as-is apart from separator whitespace. Returns null for a blank
 * or malformed line (no name before `=`).
 *
 * `serializeSetCookie(parseSetCookieLine(line))` round-trips a canonical
 * line byte-for-byte, so the relay can re-emit what the API sent.
 */
export function parseSetCookieLine(line: string): ParsedSetCookie | null {
  const parts = line.trim().split(";");
  const [first = "", ...rest] = parts;
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (name === "") return null;
  const attributes = rest
    .map((token) => token.trim())
    .filter((token) => token !== "");
  return { name, value, attributes };
}

/** Re-emit a parsed cookie as one Set-Cookie line (attributes verbatim). */
export function serializeSetCookie(parsed: ParsedSetCookie): string {
  return [`${parsed.name}=${parsed.value}`, ...parsed.attributes].join("; ");
}

/**
 * Read the Set-Cookie lines of a response (undici exposes them via
 * `headers.getSetCookie()`; a `headers.get("set-cookie")` fallback keeps
 * Headers mocks and non-undici implementations working). Falsy lines are
 * dropped.
 */
function setCookieLines(response: Response): string[] {
  const raw: Array<string | null> =
    response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie")];
  return raw.filter((line): line is string => typeof line === "string" && line.trim() !== "");
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

/** Parse the API's standard `{"error": "<string>"}` body, or null. */
function errorFromBody(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const error = (json as Record<string, unknown>).error;
  return typeof error === "string" && error !== "" ? error : null;
}

/**
 * One request whose ENTIRE abort budget covers the body read too (review
 * finding): the timer starts at request send, the signal guards the header
 * exchange, and the body is raced against the SAME abort event — an upstream
 * that answers headers and then stalls cannot hang the relay past the knob.
 * A body read abandoned by the abort resolves to `json: null` (the caller
 * maps unreadable as fail-closed); a network failure or abort before headers
 * resolves the whole call to null. Never throws, never logs.
 */
async function requestJson(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<{ response: Response; json: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs());
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    // Headers arrived. Race the body read against the abort event: the timer
    // (one total budget from request start) fires the abort, which settles
    // the race with null instead of hanging on a stalled upstream.
    const aborted = new Promise<null>((resolve) =>
      controller.signal.addEventListener("abort", () => resolve(null), { once: true }),
    );
    const json = await Promise.race([
      response.json().catch(() => null),
      aborted,
    ]);
    return { response, json };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The session cookie from a login response, or null (fail-closed, review
 * finding): the ADMIN_COOKIE_NAME-named line only, with a non-empty value.
 * A 200 that mints any other cookie (or an empty value) is NOT a session —
 * the relay must never send the operator into the console without one.
 */
function sessionCookieFrom(response: Response): ParsedSetCookie | null {
  for (const line of setCookieLines(response)) {
    const parsed = parseSetCookieLine(line);
    if (parsed !== null && parsed.name === ADMIN_COOKIE_NAME && parsed.value !== "") {
      return parsed;
    }
  }
  return null;
}

/**
 * POST {apiUrl}/api/admin/login with the credentials as JSON and the
 * X-Requested-With header the API's CSRF middleware requires.
 *
 * Resolves the typed outcome above; never throws. On 200 the API's
 * Set-Cookie line is parsed into a {@link ParsedSetCookie} the caller
 * re-sets on the web response (lib/admin-session.ts) — a 200 WITHOUT a
 * usable cookie fails closed, because the relay must never send the
 * operator into the console without a session.
 */
export async function adminLogin(
  apiUrl: string,
  username: string,
  password: string,
  fetchImpl: FetchLike = fetch,
): Promise<AdminLoginResult> {
  const url = `${apiUrl.replace(/\/+$/, "")}/api/admin/login`;
  const sent = await requestJson(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [X_REQUESTED_WITH_HEADER]: X_REQUESTED_WITH,
      },
      body: JSON.stringify({ username, password }),
    },
    fetchImpl,
  );
  if (sent === null) {
    // Network failure or abort past the timeout: fail closed.
    return { ok: false, error: API_UNREACHABLE };
  }
  const { response, json } = sent;

  if (response.status === 200) {
    // The login body is irrelevant (the cookie IS the session); only the
    // status line and Set-Cookie matter, and the cookie must be OURS.
    const cookie = sessionCookieFrom(response);
    if (cookie === null) {
      return { ok: false, error: NO_SESSION_COOKIE };
    }
    return { ok: true, cookie };
  }

  // 401/403/429 map to the API's exact contract strings (the literals below
  // ARE the API's bodies); 400/503 carry the API's own error text (which the
  // slug mapper classifies: credential verdict vs retry-later).
  switch (response.status) {
    case 401:
      return { ok: false, error: "invalid username or password" };
    case 403:
      return { ok: false, error: "missing X-Requested-With header" };
    case 429:
      return {
        ok: false,
        error: "too many concurrent login attempts; retry shortly",
      };
    default:
      return { ok: false, error: errorFromBody(json) ?? API_UNREACHABLE };
  }
}

/**
 * GET {apiUrl}/api/admin/whoami forwarding the session cookie value.
 *
 * 200 -> the username the session authenticated; 401 -> "not authenticated";
 * anything else (or a network/abort failure) -> unhealthy, sign in again.
 * Never throws.
 */
export async function adminWhoami(
  apiUrl: string,
  cookieValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<AdminWhoamiResult> {
  const url = `${apiUrl.replace(/\/+$/, "")}/api/admin/whoami`;
  const sent = await requestJson(
    url,
    {
      method: "GET",
      headers: { cookie: `${ADMIN_COOKIE_NAME}=${cookieValue}` },
    },
    fetchImpl,
  );
  if (sent === null) {
    return { ok: false, error: "admin API unreachable or unhealthy; sign in again" };
  }
  const { response, json } = sent;
  if (response.status === 200) {
    const username =
      typeof json === "object" && json !== null
        ? (json as Record<string, unknown>).username
        : undefined;
    if (typeof username === "string" && username !== "") {
      return { ok: true, username };
    }
    return {
      ok: false,
      error: "admin API unreachable or unhealthy; sign in again",
    };
  }
  if (response.status === 401) {
    return { ok: false, error: "not authenticated" };
  }
  return {
    ok: false,
    error: "admin API unreachable or unhealthy; sign in again",
  };
}

/**
 * GET {apiUrl}{path} forwarding the session cookie (reads for the admin
 * server components). Returns the status and parsed JSON and NEVER throws:
 * on network/abort the status is 0 and the json is null — the caller maps
 * (tasks 3-4 render per-endpoint errors).
 */
export async function adminGet(
  apiUrl: string,
  path: string,
  cookieValue: string,
  fetchImpl: FetchLike = fetch,
): Promise<AdminApiResponse> {
  const url = `${apiUrl.replace(/\/+$/, "")}${path}`;
  const sent = await requestJson(
    url,
    {
      method: "GET",
      headers: { cookie: `${ADMIN_COOKIE_NAME}=${cookieValue}` },
    },
    fetchImpl,
  );
  if (sent === null) {
    // Network failure or abort past the timeout: status 0 is NOT an HTTP
    // status — the caller maps it as fail-closed.
    return { status: 0, json: null };
  }
  return { status: sent.response.status, json: sent.json };
}

/**
 * Relay one admin mutation (tasks 3-4 building block): sends the session
 * cookie AND the X-Requested-With CSRF header with a JSON body. Same
 * never-throws `{status, json}` contract as {@link adminGet}.
 */
export async function adminMutate(
  apiUrl: string,
  path: string,
  method: string,
  cookieValue: string,
  body: unknown,
  fetchImpl: FetchLike = fetch,
): Promise<AdminApiResponse> {
  const url = `${apiUrl.replace(/\/+$/, "")}${path}`;
  const sent = await requestJson(
    url,
    {
      method,
      headers: {
        "content-type": "application/json",
        [X_REQUESTED_WITH_HEADER]: X_REQUESTED_WITH,
        cookie: `${ADMIN_COOKIE_NAME}=${cookieValue}`,
      },
      body: JSON.stringify(body),
    },
    fetchImpl,
  );
  if (sent === null) {
    return { status: 0, json: null };
  }
  return { status: sent.response.status, json: sent.json };
}

/*
  Pure unit tests for the relay-route helpers (lib/admin-relay.ts): the
  same-origin guard and the relative 303. No server and no network — the
  guard is a pure Request -> Response | null function.

  Contract asserted (D2b review-hardened, ADMIN-01):
  - no Origin header passes (non-browser clients carry no ambient
    credentials to abuse);
  - an Origin passes ONLY on authority match with the Host header, BOTH
    sides normalized through URL parsing: explicit default ports strip
    (443 for https), IPv6 canonicalizes, ports compare;
  - scheme-agnostic BY DESIGN (documented): a same-authority scheme
    mismatch passes — the CSRF threat model is cross-site posts, whose
    authorities always mismatch; forging a same-authority origin needs TLS
    compromise. So http/https mismatches on the SAME authority pass;
  - malformed Origin, the sandboxed "null" Origin, and a missing Host
    reject (403);
  - the 403 carries no body and no Location;
  - relayRedirect answers 303 with a RELATIVE location (no http(s)://
    prefix — host-stable behind proxies and loopback renames).
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import { relayRedirect, sameOriginGuard } from "../lib/admin-relay.ts";

/** A POST Request with explicit Origin/Host headers for the guard. */
function guardRequest({ origin, host }) {
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (host !== undefined) headers.host = host;
  return new Request("http://web.test/admin/api/login", {
    method: "POST",
    headers,
  });
}

test("guard: no Origin header passes (non-browser clients)", () => {
  assert.equal(sameOriginGuard(guardRequest({ host: "shop.example" })), null);
});

test("guard: exact authority match passes", () => {
  assert.equal(
    sameOriginGuard(
      guardRequest({ origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" }),
    ),
    null,
  );
  assert.equal(
    sameOriginGuard(
      guardRequest({ origin: "https://shop.example", host: "shop.example" }),
    ),
    null,
  );
});

test("guard: explicit default ports normalize on BOTH sides", () => {
  // Host spells the https default port, Origin omits it.
  assert.equal(
    sameOriginGuard(
      guardRequest({ origin: "https://shop.example", host: "shop.example:443" }),
    ),
    null,
  );
  // Origin spells the default port, Host omits it.
  assert.equal(
    sameOriginGuard(
      guardRequest({ origin: "https://shop.example:443", host: "shop.example" }),
    ),
    null,
  );
});

test("guard: port MISMATCH rejects (cross-site)", () => {
  const res = sameOriginGuard(
    guardRequest({ origin: "http://127.0.0.1:1", host: "127.0.0.1:3100" }),
  );
  assert.equal(res?.status, 403);
  assert.equal(res?.headers.get("location"), null);
});

test("guard: different authority rejects (cross-site)", () => {
  const res = sameOriginGuard(
    guardRequest({ origin: "http://evil.example", host: "127.0.0.1:3100" }),
  );
  assert.equal(res?.status, 403);
});

test("guard: same authority, scheme mismatch PASSES (scheme-agnostic, documented)", () => {
  // The route cannot know the deployment scheme; the CSRF model is
  // authority (cross-site). This pins the documented decision.
  assert.equal(
    sameOriginGuard(
      guardRequest({ origin: "http://shop.example", host: "shop.example" }),
    ),
    null,
  );
});

test("guard: IPv6 canonicalizes on both sides", () => {
  assert.equal(
    sameOriginGuard(
      guardRequest({ origin: "http://[::1]:3000", host: "[::1]:3000" }),
    ),
    null,
  );
  // Expanded IPv6 spelling canonicalizes to the compressed form.
  assert.equal(
    sameOriginGuard(
      guardRequest({
        origin: "http://[0:0:0:0:0:0:0:1]:3000",
        host: "[::1]:3000",
      }),
    ),
    null,
  );
});

test("guard: malformed Origin, sandboxed null Origin, missing Host reject", () => {
  assert.equal(
    sameOriginGuard(guardRequest({ origin: "not a url", host: "shop.example" }))?.status,
    403,
  );
  assert.equal(
    sameOriginGuard(guardRequest({ origin: "null", host: "shop.example" }))?.status,
    403,
  );
  assert.equal(sameOriginGuard(guardRequest({ origin: "https://shop.example" }))?.status, 403);
});

test("relayRedirect: 303 with a RELATIVE location, no body", () => {
  const res = relayRedirect("/admin/login?error=invalid");
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/login?error=invalid");
  assert.doesNotMatch(res.headers.get("location") ?? "", /^https?:\/\//i);
  assert.equal(res.headers.get("set-cookie"), null);
});
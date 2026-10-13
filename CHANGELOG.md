# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added
- `web/` D2b task 3 (ADMIN-01, SCOPE-01): admin settings page per the
  founder toggle spec — plain HTML forms with NO authored client JS,
  English-only admin, `globals.css` token classes only (CSS-01). The seven
  company keys in deliberate display order (brand.name, brand.name_native,
  site.url, contact.whatsapp, currency, analytics.ga_measurement_id,
  analytics.gsc_verification). Toggle semantics are PRESENCE-WINS
  (CONFIG-01): ON saves the value; OFF greys out the input (server-rendered
  from the persisted state — no client JS) and persists the key EMPTY;
  "Delete override" reverts to the env default. The page READS
  `GET /api/settings` (public, whitelist-only, INCLUDES empties) precisely
  so OFF (empty override persisted) is distinguishable from reverted (no
  row). Required keys `brand.name`/`site.url` render NO OFF button (the API
  400s empty for them) and a RED warning (role=`alert`, the new semantic
  `error` token in `globals.css` — `glow-ember` is amber and does not
  satisfy the founder's "red warning"; the admin console is operator
  tooling, so the storefront's "glow as the only saturated colour" rule
  does not govern it) when the key resolves empty on BOTH layers —
  PRESENCE-WINS TRUTH (review fix): a defensively present empty override
  SUPPRESSES the env default (the resolver does not fall back for a
  present key), so it shows the warning too, never the env value as if
  effective; whitespace-only brand.name classifies ON but resolves empty
  and warns as well. The OFF row's input renders MUTED but ENABLED
  (review fix): a `disabled` input is not a successful control, so Save on
  an OFF row would have silently re-persisted the empty override — the
  muted classes carry the founder spec's "greys out" while Save with a
  typed value turns the key back ON directly (the empty override persists
  until the nonempty save; warnings merge row-model + resolver-failure
  sources, never discarding one for the other). `currency` has no OFF state
  (always resolves, code default HKD, ISO-validated by the API). Per row the
  page shows the current-state note (override value / explicitly OFF / no
  override + env default) and the effective value. Writes go through the
  relay `web/app/admin/api/settings/[key]` (outside the `(authed)` group,
  like the other relays): same-origin guard -> whoami-confirmed session ->
  `PUT {"value"}` / `PUT {"value": ""}` (explicit OFF) / `DELETE` (no body —
  the D2a delete handler extracts none) via `adminMutate` (session cookie +
  `X-Requested-With` added server-side; the API re-validates everything —
  UI hints are UX, not validation) -> 303 RELATIVE redirect with a
  slug-only query (`?saved=<key>` / `?error=invalid|notauthenticated|network`
  with a generic "Nothing saved." fallback; the API's raw error text never
  enters a URL). DELETE 404 `settings override not found` maps to SAVED
  (idempotent revert: already at the env default). `?saved=<key>` is echoed
  only for keys of the closed set. `web/lib/admin-settings.ts` is the pure
  injectable model (key sets + English labels/hints, raw `NEXT_PUBLIC_*` env
  defaults, presence-wins classification, row models with `missingRequired`,
  the result->slug mapping and `dispatchSettingAction`). The dashboard
  placeholder now links Settings (products/content editors remain a
  placeholder for task 4). 31 new unit tests
  (`test/admin-settings.test.mjs` 23 + `test/admin-settings-relay.test.mjs`
  9 — incl. the presence-wins required-empty pin, the whitespace-only
  brand.name pin, the OFF->ON Save flow, and the DELETE-404 contract as an
  independent literal string), 246 total; zero existing tests touched.
  Review fixes folded in: the OFF-row input is muted-ENABLED (a disabled
  input is not submitted — Save on an OFF row would have silently
  re-persisted the empty override); the red warning uses the new semantic
  `error` token (the spec says red; `glow-ember` is amber); required-empty
  display is presence-wins honest (an empty override suppresses the env
  default and warns, never shows env as effective); warnings merge
  row-model and resolver sources; propagation copy describes the 60-second
  revalidation lease + background regeneration (request-triggered
  stale-while-revalidate), not a deadline promise.
- `web/` D2b (ADMIN-01): admin sign-in page + session-cookie relay +
  session forwarding. The browser NEVER calls the Rust admin API directly:
  a plain HTML form POSTs to `web/app/admin/api/login`, which relays
  server-side to `POST /api/admin/login` (adding `X-Requested-With` itself),
  parses the API's `Set-Cookie` and re-sets the SAME cookie on the WEB
  response (`admin_session`; HttpOnly; SameSite=Lax; Path=/; Max-Age from
  the API; Secure iff the API sent it) before a 303. The browser then
  presents `admin_session` to the web host and admin server components
  FORWARD it as a `Cookie` header on server-side GETs to the Rust admin API
  (`requireAdminSession` gates every (authed) page via
  `GET /api/admin/whoami`); logout is a cookie clear (stateless sessions —
  no API call exists or is needed). Host-scoped cookie, zero CORS against
  the API, the API's XRW/CSRF contract untouched. Web-side CSRF posture
  (review-hardened): BOTH relay routes carry a same-origin guard
  (`lib/admin-relay.ts`): a browser POST's `Origin` must match the request's
  `Host` AUTHORITY, both sides URL-normalized (default ports strip, IPv6
  canonicalizes; no-`Origin` requests pass for non-browser tools; malformed
  `Origin` incl. the sandboxed `null` rejects 403); the comparison is
  deliberately SCHEME-AGNIC (a route cannot know the deployment scheme:
  cross-SITE posts always mismatch, a same-authority scheme confusion needs
  broken TLS, and a reverse proxy must forward `Host`/`Origin` consistently,
  M3 note) — which closes cross-site logout-CSRF; the residual
  login-CSRF (FORCE-INTO-ATTACKER-SESSION) is explicitly accepted
  under the single-operator threat model (the API's XRW guard is
  SERVER-side-only: the relay adds the header on every call, so it is not
  browser protection here; revisit if admin ever goes multi-user, M3+).
  Relay 303s carry RELATIVE `Location` values (host-stable: an absolute
  URL from `request.url` would bounce a 127.0.0.1 visitor to `localhost`
  and leak the internal origin behind a reverse proxy).
  `lib/admin-client.ts` is the pure injectable client (Set-Cookie
  parse/serialize round-tripping attribute tokens, the exact
  status->error contract strings, fail-closed "login succeeded but no
  session cookie" on a 200 without an `admin_session`-named non-empty
  cookie — the pick is BY NAME among all Set-Cookie lines, so a 200 minting
  any other cookie is not a session; the `fetchTimeoutMs` abort budget
  covers the BODY READ TOO — the body races the same abort event, so an
  upstream that answers headers then stalls cannot hang the relay (login
  needs only headers, so it still succeeds; whoami/read failures resolve
  fail-closed); never throws, never logs secrets);
  `lib/admin-session.ts` is the thin `next/headers` glue (cookie fidelity
  is SEMANTIC: Next normalizes casing/order and derives `Expires` from
  Max-Age). Relay errors
  redirect with SAFE SLUGS only (invalid/form/notready/busy/network —
  credential verdicts are the ONLY strings that may say "wrong password";
  every other failure — infra failures incl. `database not configured`, XRW
  missing (a relay bug: the API rejects XRW-less BEFORE judging), and ANY
  UNKNOWN string — maps to retry-later guidance; the
  API's raw error strings never enter a URL; the page maps slugs through a
  `Map`, so `?error=__proto__` renders no message and cannot index a
  prototype). The (authed) route group
  `app/admin/(authed)` (login + relay routes stay OUTSIDE it) renders a
  minimal shell + dashboard placeholder that tasks 3-4 replace with the
  editors. Admin is deliberately ENGLISH-ONLY (operator tooling is not the
  bilingual customer contract, I18N-01; `lang="en"` document root) and
  carries a second document root `app/admin/layout.tsx`: the app has no
  root `app/layout.tsx` by design and Next 15 exits the build for a page
  whose chain has no root layout. The sign-in page reads the brand from raw
  env with a neutral "Admin" fallback (deliberately NOT `resolveSiteConfig`
  — it must render when the API is down). Token classes from
  `globals.css` only (CSS-01); no AUTHORED client JS — the forms are plain
  HTML that works without JavaScript (Next's framework hydration scripts
  still ship). Tests:
  `test/admin-client.test.mjs` (unit: header/body/XRW assertions,
  parse/serialize round-trip, exact status->error mappings, name-validated
  cookie pick incl. wrong-name/empty/multi-line, `loginErrorSlug`
  classification incl. unknown->retry, stalled-body login/whoami under the
  abort budget) + `test/admin-relay.test.mjs` (unit: guard authority
  normalization — default ports both sides, IPv6 canonicalization, port
  mismatch, scheme-agnostic documented pass, malformed/null Origin, missing
  Host, relative-303 shape) +
  `test/admin-routes.test.mjs` (behavioral: form shape + relay action,
  exact slug message, `__proto__` renders nothing, no-cookie and
  garbage-cookie redirects, blank-form slug, wrong-creds 303 + no cookie,
  right-creds 303 + relayed Path/HttpOnly/Lax/Max-Age (no invented Secure;
  redacted diagnostics — bearer tokens never printable by a failing
  assertion), same-origin Origin passes, cross-origin login/logout 403,
  forwarded-cookie dashboard "signed in as <user>", logout deletes with
  Max-Age=0 exactly; RELATIVE Location pinned) — 49 new tests
  (27 admin-client unit + 9 admin-relay unit + 13 admin-routes behavioral),
  215 total. The behavioral suite
  is fail-loud and SKIP-FREE: it probes the API + seeded DB + gate
  bootstrap creds before running (`ADMIN_TEST_USERNAME` /
  `ADMIN_TEST_PASSWORD`, defaults `admin-test` /
  `test-admin-password-fake-0001` — the api gate recipe values, obviously
  fake) and detects a stale `.next` build with an explicit rebuild
  message. Live gate evidence: 215/215 twice (ambient exports and clean
  shell), build 23 pages + 4 dynamic admin routes, curl end-to-end
  (form -> 303 + cookie -> forwarded whoami dashboard -> logout Max-Age=0;
  cross-origin 403s; relative Location; `__proto__` renders nothing).
- `api/` D2a: admin auth surface (`src/admin.rs`). `POST /api/admin/login` +
  `GET /api/admin/whoami`; stateless HMAC-SHA256 session cookies
  (base64url `{sub,exp}` payload, `SESSION_COOKIE_NAME`/`SESSION_TTL_SECS`,
  HttpOnly + SameSite=Lax + Secure by default via
  `SESSION_COOKIE_SECURE`). Argon2id verification (v19, m=19456) with a
  dummy-hash comparison on unknown users (no user enumeration, no timing
  oracle); generic 401s. Bootstrap upserts the initial admin at boot when
  `ADMIN_USERNAME`/`ADMIN_PASSWORD` are set — rotation is fail-closed via a
  tri-state: `Rotation::None` (unset) or an APPLIED rotation enables login;
  a REQUESTED-but-failed rotation (DB error/timeout) keeps login disabled
  until a clean boot, and a present-but-blank or non-Unicode value BLOCKS
  (a botched rotation can never re-enable the stale credential).
  CSRF: every non-GET/HEAD/OPTIONS under `/api/admin` — login included —
  requires a non-empty `X-Requested-With` header (403 otherwise; cross-site
  forms cannot set it). Admission control: argon2 runs under
  `LOGIN_MAX_CONCURRENT` (default 2) blocking permits + spawn_blocking,
  429 over the cap; the permit is held for the whole verification so
  cancellation cannot escape the bound; `LOGIN_LOOKUP_TIMEOUT` (10s)
  bounds handler occupancy. Tests include a Node-computed interop vector
  for the cookie format (mint in JS, verify in Rust) plus forged/reformed
  payload rejections.
- `api/` D2a: admin CRUD surface (`src/admin_crud.rs`), all routes on the
  admin-protected router (session cookie + `X-Requested-With` CSRF):
  products (create/partial update — deliberately no DELETE, products are
  data), product_content upsert, reference_prices upsert + delete (=
  verification pending), pieces insert/reassign/delete, site_content
  upsert + delete, settings override upsert + delete (= revert to env), and
  `GET /api/admin/audit-log` (last 200 rows). Pure validation runs BEFORE
  any DB work (400 + specific `ErrorBody`): slug/brand/model/price/art
  rules, product-content field + locale + value rules, reference-price
  range + absolute-http(s) URL + real `YYYY-MM-DD` date, piece numbers,
  site-copy rules, and the settings WRITE whitelist (D1 enforced
  `PUBLIC_SETTING_KEYS` only on reads — D2 enforces writes too) plus
  secret-looking-key rejection (defense in depth), no-toggle `brand.name` /
  `site.url`, `^[A-Z]{3}$` currency, and empty = explicit OFF for optional
  keys (CONFIG-01 presence-wins). Every successful mutation writes its
  `audit_log` row in the SAME transaction as the mutation (commitment 2,
  actor from the session, never the body), then fires the commitment-5b
  revalidation webhook (`{"secret", "tags"}` to `REVALIDATE_URL`, tags
  `catalogue` / `site-content` / `settings`) fire-and-forget in a spawned
  hyper-1 HTTP/1 client task — one warn! on failure, no retries (the 60s ISR
  window is the documented fallback). New env knobs: `LOCALES` (API-side
  locale mirror for write validation, default `en,zh-HK`), `REVALIDATE_URL`
  (absolute `http://` only — the webhook client has no TLS) and
  `REVALIDATE_SECRET` (webhook off with a boot warn on misconfiguration).
  Dependencies: `hyper` 1 (client, http1) + `hyper-util` (tokio IO adapter;
  both already in the tree via axum).
- `api/` D2a (review hardening, two reviewer passes on the CRUD slice):
  `validate_source_url` now requires a non-empty host and a valid u16 port
  (previously `https://:443/x` and `host:notaport` reached the DB);
  `update_product` gained the positive-ID check every other handler had;
  NUL bytes are rejected client-side across ALL free-text writes (Postgres
  TEXT cannot hold them — create brand/model, patch brand/model/family,
  content values, source names/URLs, site keys/values incl. the
  percent-encoded `%00` DELETE path, settings values) as the 400s they are,
  not 503s; `LOCALES` is now pair-strict (exactly two distinct BCP-47-style
  tags, mirroring the web tier's `parseLocales`); `REVALIDATE_URL` boot
  warns no longer log the rejected raw value; the webhook client drops
  fragments (RFC 9110) and rejects whitespace authorities; admin GETs
  (`/products`, `/audit-log`) carry `Cache-Control: no-store`. Gate green:
  fmt clean, clippy `-D warnings` clean, 150/150 tests (103 unit + 47
  integration; validation-before-DB and auth/CSRF/deletes/method-fallback
  pinned with `pool: None`).

- `api/` D2a (start): admin auth schema + dependencies.
  Migration `0004_admin.sql`: `admin_users` table (username `TEXT UNIQUE`
  with cookie/log-safe charset CHECK `^[A-Za-z0-9_-]{1,64}$`, argon2id
  PHC `password_hash`, `created_at`). Deliberately NO seed row — no secrets in
  the repo: the server upserts the initial admin at boot from
  `ADMIN_USERNAME`/`ADMIN_PASSWORD` when both are set. Sessions are stateless
  HMAC-SHA256 cookies signed with `SESSION_SECRET` (env-only, never settings
  or admin-editable): a token carries its own `{sub, exp}` + signature, so a
  stolen cookie cannot be forged or extended, only replayed until expiry.
  Dependencies: `argon2` 0.5, `hmac` 0.12, `sha2` 0.10. Gate green before the
  change: fmt clean, clippy `-D warnings` clean, 31/31 tests.

- `web/` M2 T4 SEO surface: Product JSON-LD on every product page (name,
  sku, brand, absolute offer URL, price as an integer-math string in the
  configured currency; `availability` deliberately omitted — stock is live
  fail-closed data and JSON-LD is baked at build, so an InStock claim would
  be an unconfirmed stock statement in SSR HTML, which commitment 5b
  forbids), canonical + hreflang + x-default links on home and product pages
  (canonical self-referencing per locale; hreflang uses the htmlLang values
  `en`/`zh-Hant-HK`), `app/sitemap.ts` (both locales x (home + 8 products) =
  18 absolute URLs; `lastModified` omitted — nothing tracks content mtime),
  `app/robots.ts` (allow all, disallow /api/, absolute sitemap URL). GA4 via
  `next/script` + Search Console verification meta, both env/settings-gated
  and OFF by default (GA-OFF-01; invalid GA ids resolve to OFF — shape
  validation is a trust boundary for the script URL). `NEXT_PUBLIC_SITE_URL`
  is now REQUIRED (canonical/hreflang/sitemap/robots/JSON-LD derive from it;
  missing fails the build loudly). `lib/seo.ts` (absolute URLs, alternates,
  JSON-LD builder) + `components/analytics.tsx`. Q3 resolved: the bare 404
  shell imports `globals.css`, so the token stylesheet loads routeless — the
  404's inline hex duplication is deleted and the component styles from
  token classes (pinned by test: stylesheet link present, no hex in the 404
  document). Availability provider's ttl/timeout props are REQUIRED
  (compile-time wiring guarantee: the server resolves the env knobs, the
  client never reads env). Rename sweep: `havn-web` -> `lamp-web`,
  `havn-api` -> `lamp-api`, HAVN literals neutralized in source comments,
  READMEs and the untracked PRD (NAME-01; historical CHANGELOG entries
  stay). Tests: `test/seo.test.mjs` (unit) + `test/seo-routes.test.mjs`
  (behavioral: JSON-LD shape, canonical/hreflang, 18-URL sitemap, robots
  directives, GA/GSC off-by-default, 404 stylesheet) — 166 total.

- `api/` D1.2 read endpoints: GET /api/catalogue (active SKUs only, ordered
  by id; locale-keyed content, labelled reference price or null, numbered
  pieces, derived `units_in_drop` and `total_pieces` = COUNT(*), assembled in
  Rust from simple runtime queries; no stock fields anywhere — live stock
  stays fail-closed on /api/products), GET /api/site-content
  (key -> locale -> value), GET /api/settings (flat, PUBLIC_SETTING_KEYS
  whitelist: non-whitelisted keys skipped with `warn!`, secrets never
  readable). Config knobs (ENV-01): `CORS_ORIGIN` (default
  `http://localhost:3000`, invalid value warns + falls back) and
  `MAX_POOL_CONNECTIONS` (default 5, clamped to 1..=64) replace inline
  literals. New modules `catalogue.rs`, `content.rs`, `state.rs`, `config.rs`
  with unit tests (DTO key sets, no-stock contract, whitelist filter,
  origin/pool parsing). Contract tests: all three 503 without DATABASE_URL.
- `api/` D1 migrations: 0002 (products content columns + product_content,
  reference_prices, pieces, site_content, settings, audit_log schema — D2
  admin needs no further migration) and 0003 (idempotent opening-drop seed,
  DO NOTHING so admin edits always win over re-seeding; {brand}-templated
  copy; settings deliberately empty: overrides only).
- `web/` D1.3 white-label data layer: catalogue, site copy and settings are
  fetched at build time from the Rust API (`lib/catalog-client.ts`, fail-loud:
  malformed data throws, never renders invented content; no stock fields in
  the catalogue — live stock stays fail-closed on /api/availability).
  Fetches use Next's revalidating data cache (`revalidate: 60` + tags), the
  commitment 5b stale bound; D2 admin mutations will purge via tags. Brand,
  currency and locales are configuration (`lib/config.ts`: settings
  override → env → safe default; brand required, fails loudly when absent;
  `{brand}`/`{subject}` template rendering). `lib/i18n.ts` locale pair from
  `NEXT_PUBLIC_LOCALES` (exactly two, validated at load; html-lang/endonym
  tables with identity fallback). `lib/money.ts` `formatMoney(cents,
  currency)` for the configured ISO 4217 code (no hardcoded symbol).
  404 shells load company copy fail-soft (`lib/not-found-data.ts`: generic
  brand-free fallback, a 404 never becomes a 500). Header/footer/WhatsApp
  receive resolved config as props; site copy renders with the brand.
  Availability TTL/timeout knobs are env-configurable with 60s/10s defaults.
  `.env.example` documents the full white-label surface.
- `web/` test fixtures: `test/fixtures/seed.mjs`, the independent pin of the
  seeded copy + catalogue the behavioural suites assert against.

### Changed
- `web/` `app/robots.ts` now disallows `/admin/` alongside `/api/` (the
  private admin surface is never crawled) and the `seo-routes` robots pin
  requires the new directive (`test/seo-routes.test.mjs`).
- `web/` behavioral test suites (`routes`, `pages`, `seo-routes`) pin the
  spawned server's runtime config instead of trusting the ambient shell:
  `NEXT_PUBLIC_SITE_URL` (the asserted canonical URL, localhost:3000) and
  `NEXT_PUBLIC_BRAND_NAME` (fixture brand) are set, and the WhatsApp/GA/GSC
  vars are deleted per-suite as before. `NEXT_PUBLIC_API_URL` is set to the
  gate's build value for clarity — it is statically accessed and so inlined
  into the server bundle at build time; only a matching rebuild redirects a
  spawned server (a D2c scratch harness must rebuild with its own value).
  Why: since T4 the 60s fetch leases mean a `next start` server renders
  regenerations at request time, and the brand/site-URL config is read
  dynamically from `process.env` at RUNTIME (unlike the inlined API base) —
  a suite run >60s after `next build` from a brand-less shell made every
  regen throw (`resolveSiteConfig: brand name is required`) and race
  404s/500s into the assertions (reproduced: same tree+build flipped between
  166/166 and 164/2 run-to-run). `pages.test.mjs` previously DELETED
  `NEXT_PUBLIC_API_URL` — a no-op for the built server (the value is
  inlined), so the real ambient dependency on brand/site-url went unpinned.
  Documented precondition (same as the build): API + seeded DB reachable
  (regens fetch live). Stabilized: 3x consecutive 166/166 with expired
  leases. Unit suites hardened the same way (D2b task 2): `config.test`
  `withEnv` is now CLEAN-SLATE — every config-surface env key is deleted
  before the overrides are set, so a gate shell exporting
  `NEXT_PUBLIC_SITE_URL` (for `npm run build`) can no longer flip the
  "safe defaults" assertions run-to-run (reproduced: same tree+build
  flipped 204/206 and 206/206 with vs without ambient exports); `seo.test`
  `requiredSiteUrl` deletes the ambient site URL for its "unset" assertion
  with save/restore. Gate proven BOTH ways: 215/215 with ambient exports
  and 215/215 clean.
- `web/` D1.3: the inline TS catalogue is DELETED (`lib/catalog.ts`): SKUs,
  prices, bilingual copy, art config, reference prices, drop numbering and
  site copy now live in Postgres (migrations 0002/0003) served through the
  API. Derived counts (`total_pieces`, `units_in_drop`) are COUNTs; the
  slug-prefix art rule is gone (art_variant/art_hue are product data).
  `npm run build` now requires the Rust API + seeded DB reachable (build-time
  data dependency, documented in web/README.md and root README). Test
  suites rewritten against the seed fixtures: 142 tests total (config, i18n,
  money, catalogue-client, ui-copy, stock, whatsapp, availability x3,
  lifecycle, routes, pages).
- `api/` GET /api/products no longer returns `colourway` (migration 0002
  drops the column; colour copy moved to locale-keyed product_content served
  by /api/catalogue). Response keeps id, slug, brand, model, price_cents,
  stock_total, stock_reserved, created_at; availability contract unchanged.
- `README.md` (root): "Configuration and data principles" section — env over
  inline, CSS as the single token-file exception, data in Postgres not code;
  project renamed to lamp (brand is env-supplied per NAME-01).
- `web/README.md`: environment and data-layer sections rewritten for the
  white-label config surface and the build-time API dependency.
- `web/` storefront pages (M2 T3): editorial homepage (numbered-drop hero,
  8-SKU grid, trust strip) and 16 static product story pages (8 SKUs x
  en/zh-HK) implementing the trust architecture: independent-seller
  disclosure in trust block + footer (TRUST-01), honest pending warranty
  copy, labelled reference pricing with amounts/source/checked date
  (TRUST-02; PH 1/1 Piano shows verification pending), no delivery promises
  (commitment 7), verified-facts-only electrical copy, drop numbering 01-16
  (DROP-01), big-numeral integer-cent prices. Placeholder art with the
  lights on/off toggle (only client JS besides availability), WhatsApp
  enquiry button (hidden when env unset). Live availability: SSR HTML never
  contains a stock number (time-based ISR serves stale pages, rejected);
  `/api/availability` route handler reads the Rust API no-store with timeout
  and fail-closed 503; client provider with pure lifecycle core (60s
  confirmation TTL, in-flight-only dedupe, monotonic clock, rollback
  fail-closed, stop/remount safe) renders N left / sold out / unconfirmed
  (commitment 5b). 133 tests total, incl. independent approved-copy fixtures,
  currency whitelists, delivery-promise bans both languages, lifecycle
  stop/StrictMode/rollback suites.
- `web/lib`: catalogue + availability data layer (M2 T2) — 8-SKU bilingual
  catalogue with integer-cent prices, drop numbering 01-16, labelled reference
  prices with source/date (MyConcept Hong Kong, checked 2026-10-12; PH 1/1
  Piano intentionally null pending verification), heritage and
  verified-facts-only electrical copy (no plug promises before inspection).
  `fetchAvailability()` reads `/api/products` with 60s ISR and returns null
  (never throws, never fabricates) on any failure, so pages cannot display
  unconfirmed stock (commitment 5b). 23 unit tests; `formatHKD` integer-cents
  formatter.
- `web/`: HAVN storefront skeleton — Next.js 15.5 App Router, React 19, strict
  TypeScript, Tailwind CSS v4. Bilingual locale routing (`/en`, `/zh-HK`) with
  per-locale `<html lang>`, equal-weight paired copy (I18N-01) and WCAG 3.1.2
  language-of-parts markup; Next/font pairing (Fraunces + Space Grotesk Latin,
  Noto Serif/Sans TC Chinese); design tokens (warm neutrals, charcoal, single
  glow accent, no gradients, AA-verified trust-copy contrast). Global 404 shell
  via `experimental.globalNotFound` (owns document language; request-time
  notFound() catch-all rejected: it escapes SSR and loses `<html lang>`).
  `node --test` route suite (9 tests) covering status codes, document language,
  paired typography, localized metadata and 404 content, with mutation-verified
  lead-language assertions.
- `api/`: HAVN API skeleton — Axum 0.8 + SQLx/Postgres. GET /health, GET /api/products
  (503 without DATABASE_URL, server still boots). Money as integer cents
  (`format_hkd`, panics on negative). `validate_slug`. Migration 0001: products table
  with price/stock CHECKs including table-level `stock_reserved <= stock_total`.
  13 tests: unit + HTTP contract (health, missing-DB 503, no driver-error leak).
- Repository initialised: README, CHANGELOG, .gitignore.
- Vision (untracked, contains cost data): HAVN, curated designer homeware house for
  Hong Kong; opening drop of 16 Louis Poulsen units purchased and in transit.
- Design doc (untracked): `docs/designs/havn-opening-drop.md` — trust-first
  storefront, Rust + Next.js custom build, market strategy, 90-day launch plan.

### Decisions
- **D2b (task 3) — the DB-mutating behavioral settings suite is deferred to
  D2c (documented placement; matches the founder's migration-harness -> D2c
  placement).** Form -> relay -> `PUT`/`DELETE` -> `GET /api/settings` state
  assertions need a scratch Postgres: the shared verify DB is raced by the
  storefront suites and a settings mutation is sitewide (brand, currency,
  site URL), so a live mutation would poison parallel runs. Task 3 is
  therefore covered by pure unit tests (`test/admin-settings.test.mjs`,
  `test/admin-settings-relay.test.mjs` — classification, row models, exact
  dispatch requests incl. cookie/XRW headers and slug mapping) plus the
  architect live gate (lint, typecheck, full suite, manual curl flow).
- **D2b (task 1) — the web-tier revalidation receiver is REJECTED (founder,
  2026-10-13).** The evaluated design (secret-guarded `POST /api/revalidate`
  web route calling `revalidateTag` on `catalogue` / `site-content` /
  `settings`) works in isolation but cannot ship in this architecture: on-demand
  tag invalidation deletes the full route cache and `dynamicParams = false`
  SSG pages cannot re-render at request time — Next.js answers
  `NoFallbackError`: sitewide 404 + sitemap 500 until a full rebuild
  (reproduced live against Next 15.5.27; correct secret -> 200 -> sitewide
  404, webhook off -> the same mutation lands clean; externally confirmed
  standard behavior — Netlify support forums, vercel/next.js discussion
  #86503). The 60s fetch-revalidate window (live since D1/T4) is THE
  admin-mutation propagation mechanism for EXISTING routes (prices, copy,
  reference prices, pieces, settings): request-triggered
  stale-while-revalidate — the first request after a lease expiry serves
  last-good, and the background regen lands for the next request (observed
  stale at +72s, fresh at +80s; founder: price updates are infrequent).
  Route-set changes (create/activate/deactivate altering the slug set)
  deliberately require a rebuild — `generateStaticParams` +
  `dynamicParams = false` is the no-request-time-notFound() contract, and a
  deactivated SKU serves last-good until a rebuild retires it (pinned by
  the D2c inactive-SKU test). Checkout charges the database price per 5b.
  api/'s
  `REVALIDATE_URL`/`REVALIDATE_SECRET` webhook stays a dormant env-unset
  capability; do not set them in this architecture.
- Custom build (Rust/Axum backend, Next.js frontend) over hosted commerce.
- Hosting on existing Hetzner CX33 (Helsinki) with Cloudflare CDN in front;
  Singapore CX33 as the upgrade path if latency ever matters.
- Demo product imagery may be used locally during development; own photography
  required before launch.
- Business registration via the partner's existing entity; receipts, site footer
  and gateway merchant account must carry the registered entity name.

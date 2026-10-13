# lamp

Storefront for HVILE (working brand name, env-supplied: see "Configuration
and data principles" below).
Curated designer homeware, Hong Kong. Opening drop: Louis Poulsen lighting,
parallel-imported, in stock in Hong Kong, roughly 15% under authorised-dealer list.

## Configuration and data principles

Three rules govern where a value lives:

1. **Env over inline.** Every deployable, swappable scalar is an environment
   variable, never a hardcoded inline literal: brand name, canonical site URL,
   API URL, API CORS origin, WhatsApp number, GA4 measurement ID, Search
   Console verification, currency, locale set, plus operational knobs
   (timeouts, TTLs, pool sizes) with safe defaults. `web/.env.example`
   documents the web list; the api reads `PORT`, `DATABASE_URL`, `CORS_ORIGIN`,
   `MAX_POOL_CONNECTIONS`.
   The test: **swap the values in `.env` and this project runs for another
   company without touching code.**
2. **CSS is the exception.** Design tokens (palette, font stack, spacing)
   belong to `web/app/globals.css` as the single token file. They are config,
   but visual config, and stay in CSS. They are not env variables and are not
   duplicated as literals elsewhere.
3. **Data lives in Postgres, not in code.** Product content — SKUs, prices,
   bilingual copy, reference prices (source, URL, checked date), drop
   numbering, site copy — is database data: seeded into Postgres, served
   through the API, and managed by CRUD (admin console by a human now, an AI
   agent later). It is never hardcoded inline in a TS file. Derived values
   (the drop piece count) are computed from data, never a constant. Seeding is
   allowed; in-code duplication is not.

Runtime settings: the `settings` table holds admin-editable overrides for all
non-secret keys; resolution is override, then env default, then code default.
Secrets (`DATABASE_URL`, gateway/session keys) are env-only: they never enter
the database or the admin console.

## Stack

- **web/** — Next.js (App Router, TypeScript, Tailwind). Bilingual (繁體中文 / English)
  first-class. Statically generated product pages with ISR.
- **api/** — Rust (Axum, SQLx, PostgreSQL). Money is integer cents, never floats.
  Atomic stock reservations; verified gateway confirmation is the only payment
  authority; fulfilment at most once.
- **docker-compose.yml** — Postgres, api, web. Deploys to a Hetzner CX33 behind
  Cloudflare.

## Development

```bash
docker compose up db        # Postgres on :5432
cd api && cargo run         # API on :8080 (needs DATABASE_URL)
cd web && npm ci            # install from lockfile (first time)
cd web && npm run dev       # web on :3000
```

Checks before commit:

```bash
cd api && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cd web && npm run build && npm run typecheck && npm run lint && npm run test
```

## Admin console (D2, in progress)

Admin auth is argon2id (PHC strings) against the `admin_users` table
(migration `api/migrations/0004_admin.sql`). No admin is seeded — no secrets
in the repo: the server upserts the initial admin at boot when
`ADMIN_USERNAME` and `ADMIN_PASSWORD` are both set. Sessions are stateless
HMAC-SHA256-signed cookies; the signing key `SESSION_SECRET` is env-only and
never enters the database, the `settings` table, or the admin console.

D2a adds the admin auth API (`api/src/admin.rs`): at boot, when
`ADMIN_USERNAME`/`ADMIN_PASSWORD` are set, the server upserts the admin
row (argon2id hash) — a rotation is fail-closed: a requested-but-failed
rotation keeps login disabled until a clean boot, and a present-but-blank
or non-Unicode env value never re-enables the stale credential.
`POST /api/admin/login` (generic 401s, argon2id verify) and
`GET /api/admin/whoami` issue/check the HMAC cookies above; every
non-GET/HEAD/OPTIONS request under `/api/admin` — login included — must
carry a non-empty `X-Requested-With` header (cross-site forms cannot set
it), and concurrent argon2 verifications are capped
(`LOGIN_MAX_CONCURRENT`, default 2; over the cap answers 429).

D2a also adds the admin CRUD API (`api/src/admin_crud.rs`), all behind the
`require_admin` session-cookie + `X-Requested-With` CSRF middleware:

- `GET/POST /api/admin/products`, `PUT /api/admin/products/{id}` (partial
  update; products are data and have no DELETE — use the `active` toggle)
- `PUT /api/admin/product-content` (per product/locale/field upsert)
- `PUT/DELETE /api/admin/reference-prices/{product_id}` (delete =
  verification pending again)
- `POST /api/admin/pieces`, `PATCH/DELETE /api/admin/pieces/{piece_no}`
- `PUT /api/admin/site-content`, `DELETE /api/admin/site-content/{key}/{locale}`
- `PUT/DELETE /api/admin/settings/{key}` (write whitelist =
  `PUBLIC_SETTING_KEYS`; secret-looking keys are rejected; `brand.name` and
  `site.url` may never be empty; `currency` is `^[A-Z]{3}$`; empty value on an
  optional key is the explicit OFF state — deleting the row reverts to the env
  default)
- `GET /api/admin/audit-log` (last 200 rows)

D2b adds the admin web layer (task 2, login + session forwarding). The
browser NEVER calls the Rust admin API directly for admin: the admin UI is
server-rendered plain HTML (no AUTHORED client JS — the forms work without
JavaScript; Next's framework scripts still ship) and a web route relays
sign-in —
form POST -> `web/app/admin/api/login` -> server-side fetch to
`POST /api/admin/login` (the relay adds `X-Requested-With` itself) ->
parse the API's `Set-Cookie` and re-set the SAME cookie on the WEB
response (`admin_session` with the API's session semantics: HttpOnly,
SameSite=Lax, Path=/, Max-Age from the API, Secure iff the API sent it;
the relay is SEMANTIC — Next normalizes casing and derives `Expires`) ->
303 redirect with a RELATIVE `Location` (host-stable: an absolute URL from
`request.url` would bounce a 127.0.0.1 visitor to `localhost` and leak the
internal origin behind a reverse proxy). After that the browser presents
`admin_session` to the web
host; admin server components read it and FORWARD it as a `Cookie` header
on server-side GETs to the Rust admin API (session forwarding), and the
`(authed)` shell is gated by `GET /api/admin/whoami`. Logout is a cookie
clear (Max-Age=0) on the web tier — the sessions are stateless, so no API
call exists or is needed. This relay is production-correct however the API
is hosted (host-scoped cookie), keeps the admin UI zero-CORS against the
API, and leaves the API's `X-Requested-With`/CSRF contract untouched.
Web-side CSRF posture: BOTH relay routes carry a same-origin guard
(`lib/admin-relay.ts`): a browser POST's `Origin` must match the request's
`Host` AUTHORITY, with BOTH sides normalized through URL parsing (default
ports strip, IPv6 canonicalizes); requests without `Origin` pass
(curl/tests — non-browser tools carry no ambient credentials); malformed
or unparseable `Origin` (incl. the sandboxed `null`) rejects 403. The
comparison is deliberately SCHEME-AGNIC (a route cannot know the
deployment scheme from first principles): cross-SITE posts — the CSRF
threat model — always mismatch, and a same-authority scheme confusion
requires broken TLS; a reverse proxy must forward `Host`/`Origin`
consistently (M3 note). That closes cross-site logout-CSRF; the residual
login-CSRF (forcing a victim INTO the attacker's own session) is accepted
under the single-operator threat model — the API's XRW guard is
server-side-only (the relay adds the header on every call), so it is not
browser protection here; revisit if admin ever goes multi-user (M3+).
Sign-in/relay failures redirect with safe slugs only — credential verdicts
say invalid/form; EVERYTHING else (busy, not-configured, database down or
unconfigured, XRW missing — a relay bug, not a verdict — unreachable,
200-without-cookie, and any unknown string) says
retry-later, never "wrong password" when nothing was judged — and the
page maps slugs through a `Map`, so `?error=__proto__` renders nothing.
The admin console
is ENGLISH-ONLY by documented decision: it is operator tooling, and the
bilingual contract is the storefront's customer contract, not the admin's.

D2b task 3 adds the admin settings page (founder toggle spec; the seven
COMPANY keys only — SCOPE-01): `brand.name`, `brand.name_native`,
`site.url`, `contact.whatsapp`, `currency`,
`analytics.ga_measurement_id`, `analytics.gsc_verification`. Every field
renders a toggle: ON saves the value; OFF greys the field out and persists
the key EMPTY (presence-wins: an empty override is explicitly OFF and beats
the env default); deleting the override reverts to the env default. The
required keys `brand.name` and `site.url` have NO toggle (never empty — the
resolver throws without a brand name) and render a RED warning (the
semantic `error` token in `globals.css` — the one saturated colour
outside the storefront's glow register, admin-surface only) when the key
resolves empty on BOTH layers (presence-wins: a defensively present
empty override SUPPRESSES the env default and shows the warning too, and
the OFF-row input renders MUTED but enabled — a disabled input is not
submitted, which would trap the row OFF); `currency` has no OFF state
(always resolves, default HKD, ISO-validated by the API). The page READS
`GET /api/settings` (public, whitelist-only, INCLUDES empties) because the
empty override is exactly what distinguishes OFF from reverted, and it
WRITES through the web relay `/admin/api/settings/[key]` (plain HTML form
POST -> same-origin guard + whoami-confirmed session -> server-side
`PUT {"value"}` / `PUT {"value": ""}` (OFF) / `DELETE` (revert, no body) to
`/api/admin/settings/{key}` with the session cookie + `X-Requested-With` ->
303 with a slug-only redirect; the API re-validates everything). Saved
changes propagate by the fetch-revalidate cycle (THE mechanism — the
on-demand revalidation receiver was rejected, CHANGELOG Decisions D2b
task 1): the content fetches carry a 60-second revalidation lease, and the
next request after expiry serves the last-good value while the fresh one
regenerates in the background (request-triggered stale-while-revalidate,
no deadline promise); route-set changes still need a rebuild.

D2b task 4 adds the admin EDITOR surface — English-only plain-HTML pages
(no AUTHORED client JS), `globals.css` token classes only, `force-dynamic`
everywhere: `products` (the product table — id, slug, brand · model,
formatted price for ADMIN DISPLAY only, active yes/no, stock total /
reserved — plus the create form), `products/{id}` (the product patch form,
an EXPLICIT storefront-visibility form (Activate/Deactivate — the patch
form's checkbox alone can never submit `active:false`), per-locale/per-
field product-copy upserts with NON-empty values, the verified reference
price upsert/delete, and the product's numbered pieces — create /
reassign / delete), `site-content` (per key/locale save/delete + a
new-key form; keys are free-form EXCEPT the transport-unsafe `.`/`..`
rejected web-side, values non-empty), and the READ-ONLY `audit` view (the
last 200 rows, newest first). Reads: `GET /api/admin/products` (ALL rows
incl. inactive, with stock) and `GET /api/admin/audit-log` forward the
session cookie; product copy, reference prices and pieces are read from
the PUBLIC `GET /api/catalogue` — parsed by the STOREFRONT'S OWN exported
`parseCatalogue` via `adminGet` (parser parity, shared abort budget on
headers AND body), and an inactive product is legitimately ABSENT from
the catalogue, which the page states honestly — site copy from the
PUBLIC `GET /api/site-content` (also `adminGet`); both public reads are
`no-store` and a malformed or failed read renders a fail-loud panel with
NO forms. Two storefront fixes landed from the task-4 review: `family` may
be EMPTY in a catalogue row (the D2a write contract allows it; the parser
used to take the whole storefront down on it), and the Product JSON-LD
`<script>` serializes through `jsonLdScript` (`<`, `>`, `&`, U+2028/9
escaped) so admin-writable brand/model text cannot terminate the element. Every mutation goes through a
plain-form relay under `web/app/admin/api/` (`products`, `products/{id}`,
`product-content`, `reference-prices/{product_id}`, `pieces`,
`pieces/{piece_no}`, `site-content`): same-origin guard -> whoami-
confirmed session -> `web/lib/admin-editors.ts` dispatcher (session cookie
+ `X-Requested-With` added server-side; the API re-validates everything)
-> 303 with a RELATIVE Location and a slug-only query (`?saved=<dispatcher
key>`, echoed only behind a closed savedKey-shape pattern, / `?error=<slug>`
mapped through a Map — the API's raw error text never enters a URL).

Gate note for the behavioural suite `web/test/admin-routes.test.mjs`: it
needs the Rust API + seeded DB up (as for `npm run build`) with the gate's
bootstrap admin (set `ADMIN_USERNAME`/`ADMIN_PASSWORD` at API boot; the
suite reads `ADMIN_TEST_USERNAME`/`ADMIN_TEST_PASSWORD`, defaults
`admin-test` / `test-admin-password-fake-0001` — the api gate recipe
values, obviously fake, never real credentials) and a current `npm run
build` containing the admin routes. The suite is skip-free: it fails
loudly with the recipe when the API/DB or the build is missing.

Every mutation validates BEFORE any database work (free-text values reject
NUL bytes — Postgres TEXT cannot hold them — and reference-price source URLs
require a non-empty host and valid port), then mutates and writes an
`audit_log` row (actor, action, entity, entity_id, changed fields) in ONE
transaction, then fires the on-demand revalidation webhook (commitment 5b):
a fire-and-forget `POST {"secret", "tags"}` to `REVALIDATE_URL` with tags
`catalogue` / `site-content` / `settings`. `REVALIDATE_URL` must be an
absolute `http://` URL (the webhook client has no TLS) and needs
`REVALIDATE_SECRET`; unset = webhook off — a dormant capability in this
architecture (see the D2b decision below; do not set these). `LOCALES`
(default `en,zh-HK`, exactly two distinct BCP-47 tags —
the mirror of the web tier's `NEXT_PUBLIC_LOCALES` parser) gates admin
content writes. Admin GET responses carry `Cache-Control: no-store`.

**D2b decision (founder, 2026-10-13): the web-tier revalidation receiver is
REJECTED.** The evaluated design — a secret-guarded `POST /api/revalidate`
web route calling `revalidateTag` on `catalogue` / `site-content` /
`settings` — works in isolation but cannot ship in this architecture:
on-demand tag invalidation deletes the full route cache, and
`dynamicParams = false` SSG pages cannot be re-rendered at request time.
Next.js answers `NoFallbackError`: every page 404s and the sitemap 500s
until a full rebuild — reproduced live against Next 15.5.27 (correct secret
-> 200 -> sitewide 404; webhook off -> same mutation lands clean), and
externally confirmed as standard `dynamicParams = false` handling (Netlify
support forums; vercel/next.js discussion #86503). The 60-second fetch
revalidate window (live on every content fetch since D1/T4) is therefore
THE propagation mechanism for admin mutations to EXISTING routes (prices,
copy, reference prices, pieces, settings). The window is request-triggered
stale-while-revalidate: the first request after a 60s lease expiry serves
the last-good page while a background regen renders from the live API, and
the next request serves the regenerated page (observed: stale at +72s,
fresh at +80s). Open tabs do not live-update; checkout charges the
authoritative database price, never the page (commitment 5b: a 60s-old
price beats a blanked one). ROUTE-SET changes are deliberately outside the
window: slugs are fixed at build time by `generateStaticParams` with
`dynamicParams = false` (the no-request-time-`notFound()` contract), so a
created or activated product needs a rebuild to gain a route, and a
deactivated product serves its last-good page until a rebuild retires it
(the D2c inactive-SKU test pins this). Live stock keeps its separate
fail-closed channel and never bakes.

Operational note from the same live evaluation: regens read the runtime
config at request time — brand name and site URL via dynamic
`process.env[envName]` access (`lib/config.ts`), NOT inlined at build — so
a production `next start` REQUIRES the `NEXT_PUBLIC_*` config in its
environment. A server started without it serves baked pages, but its
regens throw (`resolveSiteConfig: brand name is required`), and the
failed regens were observed racing 404s/500s onto existing routes: missing
runtime env is an operational breakage, not a safe freeze — fix the env and
restart. (`NEXT_PUBLIC_API_URL` is statically accessed and so inlined into
the server bundle at build time; only the build needs it.)

## Business documents

`Vision.md` and `docs/designs/` are intentionally not committed: this repository is
public and they contain cost and margin data. Authoritative copies live on disk in
this directory.

## Demo imagery

Any images under `web/public/demo-assets/` are development placeholders gathered from
brand sites and must be replaced with our own photographs before launch. That
directory is gitignored.

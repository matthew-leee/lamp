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

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
`REVALIDATE_SECRET`; unset = webhook off (the 60s ISR window is the
fallback). `LOCALES` (default `en,zh-HK`, exactly two distinct BCP-47 tags —
the mirror of the web tier's `NEXT_PUBLIC_LOCALES` parser) gates admin
content writes. Admin GET responses carry `Cache-Control: no-store`.

## Business documents

`Vision.md` and `docs/designs/` are intentionally not committed: this repository is
public and they contain cost and margin data. Authoritative copies live on disk in
this directory.

## Demo imagery

Any images under `web/public/demo-assets/` are development placeholders gathered from
brand sites and must be replaced with our own photographs before launch. That
directory is gitignored.

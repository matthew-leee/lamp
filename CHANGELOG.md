# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added
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

### Added
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

### Added
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
- Custom build (Rust/Axum backend, Next.js frontend) over hosted commerce.
- Hosting on existing Hetzner CX33 (Helsinki) with Cloudflare CDN in front;
  Singapore CX33 as the upgrade path if latency ever matters.
- Demo product imagery may be used locally during development; own photography
  required before launch.
- Business registration via the partner's existing entity; receipts, site footer
  and gateway merchant account must carry the registered entity name.

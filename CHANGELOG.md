# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added
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

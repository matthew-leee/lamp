# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added
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

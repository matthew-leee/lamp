# HAVN

Curated designer homeware, Hong Kong. Opening drop: Louis Poulsen lighting,
parallel-imported, in stock in Hong Kong, roughly 15% under authorised-dealer list.

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
cd web && npm run dev       # web on :3000
```

Checks before commit:

```bash
cd api && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cd web && npm run build
```

## Business documents

`Vision.md` and `docs/designs/` are intentionally not committed: this repository is
public and they contain cost and margin data. Authoritative copies live on disk in
this directory.

## Demo imagery

Any images under `web/public/demo-assets/` are development placeholders gathered from
brand sites and must be replaced with our own photographs before launch. That
directory is gitignored.

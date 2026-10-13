/**
 * Server-side live availability client (Vision.md DATA-01, STOCK-01,
 * commitment 5b).
 *
 * Postgres is authoritative for live availability; this module is the only
 * place the web tier reads it, and only `app/api/availability/route.ts` calls
 * it. `/api/products` responses come from the Rust API (`api/src/main.rs`):
 *
 *   [{ id, slug, brand, model, colourway, price_cents,
 *      stock_total, stock_reserved, created_at }]
 *
 * Fail-closed contract (commitment 5b: "the page must not display a stock
 * count it cannot confirm, and the discrepancy is reported rather than
 * silently served"): on ANY failure, return `null` and never throw. A `null`
 * result means "stock could not be confirmed": the route turns it into a 503
 * and a server-side log line, and the client badge shows the number-free
 * "Confirming availability" state. Nothing here fabricates, estimates or
 * falls back to catalogue `units`.
 *
 * Caching: `cache: "no-store"` (review finding 1). Time-based ISR was tried
 * and rejected: Next's response cache resolves the previous cache entry
 * before the staleness check, so a cached page could serve stock numbers past
 * the 60s freshness bound. SSR HTML therefore never contains stock numbers at
 * all (see components/availability-context.tsx); this fetch always goes
 * straight to the API, and the browser-side display bound is the 60s
 * confirmation TTL in lib/availability-lifecycle.ts. The request also carries
 * an explicit AbortController timeout (FETCH_TIMEOUT_MS, 10s), so a stalled
 * API reaches the fail-closed branch instead of hanging forever.
 */

import { FETCH_TIMEOUT_MS } from "./availability-lifecycle.ts";

/** slug -> currently available units (stock_total - stock_reserved). */
export type AvailabilityMap = Map<string, number>;

/** Non-empty API slug string; the API owns the full charset rules. */
function parseRow(row: unknown): { slug: string; available: number } | null {
  if (typeof row !== "object" || row === null) return null;
  const { slug, stock_total, stock_reserved } = row as Record<string, unknown>;

  if (typeof slug !== "string" || slug.length === 0) return null;
  if (typeof stock_total !== "number" || !Number.isInteger(stock_total)) {
    return null;
  }
  if (typeof stock_reserved !== "number" || !Number.isInteger(stock_reserved)) {
    return null;
  }
  // Negative stock, or more reserved than held, is data we cannot confirm.
  if (stock_total < 0 || stock_reserved < 0 || stock_reserved > stock_total) {
    return null;
  }

  return { slug, available: stock_total - stock_reserved };
}

/**
 * Fetch live availability for every product, uncached.
 *
 * @returns slug -> available units on a confirmed, fully valid response
 *   (an empty map means the API confirmed an empty catalogue), or `null`
 *   when anything at all prevents confirmation. Never throws.
 */
export async function fetchAvailabilityLive(): Promise<AvailabilityMap | null> {
  const base = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!base) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/api/products`, {
      // Never cached: stock is confirmed live or not shown (commitment 5b).
      cache: "no-store",
      // A stalled API request is aborted at FETCH_TIMEOUT_MS and lands in the
      // catch below, so a hang becomes a reported failure, not a frozen page.
      signal: controller.signal,
    });

    // Only a confirmed 200 carries stock data.
    if (response.status !== 200) return null;

    const body: unknown = await response.json();
    if (!Array.isArray(body)) return null;

    const availability: AvailabilityMap = new Map();
    for (const row of body) {
      const parsed = parseRow(row);
      // One malformed row poisons the whole response: nothing is confirmable.
      if (parsed === null) return null;
      // Duplicate slugs are an API bug; the last confirmed row wins.
      availability.set(parsed.slug, parsed.available);
    }
    return availability;
  } catch {
    // Network failure, abort timeout, malformed JSON, or any unexpected
    // runtime error.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

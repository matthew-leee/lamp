/**
 * Server-side availability client (Vision.md DATA-01, STOCK-01, commitment 5b).
 *
 * Postgres is authoritative for live availability; this module is the only
 * place the web tier reads it. `/api/products` responses come from the Rust
 * API (`api/src/main.rs`):
 *
 *   [{ id, slug, brand, model, colourway, price_cents,
 *      stock_total, stock_reserved, created_at }]
 *
 * Contract (commitment 5b: never show unconfirmable stock counts): on ANY
 * failure, return `null` and never throw. A `null` result means "stock could
 * not be confirmed" and pages must not display stock numbers instead of it.
 * Nothing here fabricates, estimates or falls back to catalogue `units`.
 *
 * Caching: `next: { revalidate: 60 }` asks Next's data cache for ISR with a
 * 60s freshness window, so a stale cached value is served for at most 60
 * seconds before revalidation (design commitment 5b).
 */

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
 * Fetch live availability for every product.
 *
 * @returns slug -> available units on a confirmed, fully valid response
 *   (an empty map means the API confirmed an empty catalogue), or `null`
 *   when anything at all prevents confirmation. Never throws.
 */
export async function fetchAvailability(): Promise<AvailabilityMap | null> {
  const base = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!base) return null;

  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/api/products`, {
      // ISR: revalidate at most every 60s (commitment 5b).
      next: { revalidate: 60 },
    } as RequestInit & { next?: { revalidate: number } });

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
    // Network failure, malformed JSON, or any unexpected runtime error.
    return null;
  }
}

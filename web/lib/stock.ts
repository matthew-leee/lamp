/**
 * Stock display decision (Vision.md TRUST-02, commitment 5b).
 *
 * Pure and synchronous: this module decides WHAT the storefront may display
 * about stock, never where the data came from. lib/availability.ts is the only
 * reader of the authoritative API (DATA-01: Postgres is authoritative for live
 * availability).
 *
 * Commitment 5b: "the page must not display a stock count it cannot confirm".
 * The `unconfirmed` state therefore carries no number at all, and rendering
 * code must never invent one for it (see components/stock-badge.tsx).
 */

import type { AvailabilityMap } from "./availability";

export type StockState =
  | { kind: "left"; n: number }
  | { kind: "soldout" }
  | { kind: "unconfirmed" };

/** Shared immutable "cannot confirm" state; safe to compare or reuse. */
export const UNCONFIRMED: StockState = Object.freeze({ kind: "unconfirmed" });

/**
 * Decide the displayable stock state for one SKU.
 *
 * Rules (in order):
 * - `availability` is `null` (nothing could be confirmed) -> unconfirmed.
 * - the slug is absent from a confirmed map (the API did not cover this SKU)
 *   -> unconfirmed. A confirmed map may be empty; that confirms nothing about
 *   any given slug.
 * - the mapped value is not a non-negative integer count (a count we cannot
 *   make sense of is not a count we can confirm) -> unconfirmed.
 * - available 0 -> soldout.
 * - available n > 0 -> left n, exactly as the API confirmed it. The catalogue
 *   is never used to second-guess the authoritative count (DATA-01).
 *
 * `unitsInDrop` is the SKU's size in the numbered drop (catalog `units`). It
 * validates the caller's drop context: a badge without a real drop size is not
 * renderable, so the state is unconfirmed. It never clips or rewrites the
 * confirmed count.
 */
export function decideStock(
  availability: AvailabilityMap | null,
  slug: string,
  unitsInDrop: number,
): StockState {
  if (availability === null) return UNCONFIRMED;
  if (!availability.has(slug)) return UNCONFIRMED;
  if (!Number.isInteger(unitsInDrop) || unitsInDrop < 1) return UNCONFIRMED;

  const available = availability.get(slug);
  if (typeof available !== "number" || !Number.isInteger(available)) {
    return UNCONFIRMED;
  }
  if (available < 0) return UNCONFIRMED;
  if (available === 0) return { kind: "soldout" };
  return { kind: "left", n: available };
}

/**
 * Live availability endpoint (commitment 5b, fail-closed).
 *
 * SSR HTML never contains a stock number (review finding 1): time-based ISR
 * was rejected because a cached page could serve stock numbers past its
 * freshness bound. Instead the stock badges are client components that call
 * THIS route on mount and confirm counts live in the browser
 * (components/availability-context.tsx).
 *
 * Contract:
 *   200 { ok: true, availability: { slug: n, ... } }  confirmed, complete data
 *   503 { ok: false }                                ANY failure, never partial
 *
 * Commitment 5b: "the discrepancy is reported rather than silently served".
 * Every 503 is logged server-side with a timestamp below; the log entry is
 * the reporting leg for now. Full alerting/metrics on these lines is M3 ops
 * work and deliberately not built here.
 */

import { fetchAvailabilityLive } from "../../../lib/availability.ts";

/** Served fresh on every request; nothing on this route may be cached. */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(): Promise<Response> {
  // fetchAvailabilityLive() never throws and returns null on ANY failure.
  const availability = await fetchAvailabilityLive();

  if (availability === null) {
    console.error(
      `[availability] ${new Date().toISOString()}: live stock could not be ` +
        "confirmed (API base unset, network failure or unconfirmable payload); " +
        "responding 503 fail-closed.",
    );
    return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  }

  return Response.json(
    { ok: true, availability: Object.fromEntries(availability) },
    { status: 200, headers: NO_STORE },
  );
}

"use client";
/**
 * Client-side live availability provider (commitment 5b, fail-closed).
 *
 * A THIN React wrapper around lib/availability-lifecycle.ts: every staleness
 * and transition rule lives in that pure, injectable module (and is unit
 * tested in test/availability-lifecycle.test.mjs). This component only wires
 * React to the lifecycle session:
 *
 * - SSR HTML never contains a stock number: the session starts with nothing
 *   confirmed, so server-rendered badges show the number-free "Confirming
 *   availability" placeholder until live data is confirmed in the browser
 *   from /api/availability.
 * - Reconfirmation triggers (review finding 1, bounded freshness): provider
 *   mount always refetches; a client-side navigation (usePathname change)
 *   re-checks freshness and refetches when data is stale or absent; the
 *   document becoming visible again re-checks the same way. A confirmed
 *   number is displayable for at most CONFIRMED_TTL_MS (60s) after
 *   confirmation, enforced both by the session's TTL timer and by the
 *   freshness check at render (`session.desiredAt()`).
 * - Requests are deduplicated only while in flight (module-level shared
 *   promise, cleared when it settles): StrictMode's double-invoked effects
 *   and every badge on the page share one request, and a settled result is
 *   never reused as the dedupe key.
 * - Any failure (timeout, 503, bad payload, network error) settles on
 *   `unconfirmed`, which carries no number. There is no fallback data:
 *   availability is confirmed live or not shown (commitment 5b).
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

import type { AvailabilityMap } from "@/lib/availability";
import {
  createAvailabilitySession,
  type AvailabilitySession,
  type DesiredState,
} from "@/lib/availability-lifecycle";

export type AvailabilityState =
  | { state: "loading" }
  | { state: "live"; map: AvailabilityMap }
  | { state: "unconfirmed" };

/** Map the lifecycle's desired state onto the badge-facing union. */
function toAvailabilityState(desired: DesiredState): AvailabilityState {
  if (desired.status === "confirmed") return { state: "live", map: desired.map };
  return desired.status === "unconfirmed"
    ? { state: "unconfirmed" }
    : { state: "loading" };
}

const AvailabilityContext = createContext<AvailabilityState>({
  state: "loading",
});

/**
 * Live availability for the current page load:
 * `{state:"loading"}` | `{state:"live", map}` | `{state:"unconfirmed"}`.
 * Only `{state:"live"}` carries a number, and only while the confirmation
 * behind it is fresh (60s TTL).
 */
export function useAvailability(): AvailabilityState {
  return useContext(AvailabilityContext);
}

export default function AvailabilityProvider({
  children,
}: {
  children: ReactNode;
}) {
  // One session per provider instance, created lazily and never recreated.
  const sessionRef = useRef<AvailabilitySession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = createAvailabilitySession();
  }
  const session = sessionRef.current;

  // Re-render whenever the session's desired display state changes (the TTL
  // expiry demotion, a settle, a failure).
  const [, forceRender] = useState(0);
  useEffect(() => {
    return session.subscribe(() => forceRender((n) => n + 1));
  }, [session]);

  // Reconfirm on mount; stop on unmount. StrictMode's setup/cleanup/setup
  // replay stops then immediately restarts the same session (its in-flight
  // request dedupe is shared), while a real unmount leaves the session
  // parked: no timer, and any late settlement is dropped.
  useEffect(() => {
    session.trigger("mount");
    return () => session.stop();
  }, [session]);

  // Re-check freshness on client-side navigation.
  const pathname = usePathname();
  useEffect(() => {
    session.trigger("navigate");
  }, [session, pathname]);

  // Re-check freshness whenever the tab becomes visible again.
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        session.trigger("visibility-visible");
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [session]);

  // Freshness is re-checked at every render, so no render can ever surface a
  // number past its TTL even if a timer was throttled.
  const value = toAvailabilityState(session.desiredAt());

  return (
    <AvailabilityContext.Provider value={value}>
      {children}
    </AvailabilityContext.Provider>
  );
}

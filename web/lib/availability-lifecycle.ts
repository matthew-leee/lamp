/**
 * Client-side live availability lifecycle (commitment 5b, review findings 1-2
 * of T3-rework-2).
 *
 * Pure policy + dependency-injected session. No React, no DOM, no network
 * unless the caller injects a fetch: every side effect enters through the
 * injected fetch, clock and timer scheduler, so the whole lifecycle is unit
 * testable without a browser (test/availability-lifecycle.test.mjs).
 * components/availability-context.tsx is a thin React wrapper around this
 * module; the staleness and transition rules live HERE.
 *
 * Freshness contract (review finding 1: browsers must not cache a confirmed
 * stock number indefinitely):
 * - `CONFIRMED_TTL_MS` bounds how long a confirmed number may be displayed.
 *   The record keeps `confirmedAt` alongside each confirmed map.
 * - Once stale, the desired state falls back to the number-free "confirming"
 *   state and a refresh is triggered (TTL timer, provider mount, client-side
 *   navigation, or the document becoming visible again).
 * - If a refresh fails, the desired state becomes "unconfirmed": number-free,
 *   fail-closed (commitment 5b: "the page must not display a stock count it
 *   cannot confirm").
 *
 * Request contract (review finding 1): requests are deduplicated only WHILE IN
 * FLIGHT. The module-level shared promise is cleared the moment it settles
 * (success and failure alike), so a fulfilled result is never retained as the
 * dedupe key and every new trigger after a settle performs a fresh request.
 * A stalled request is aborted after `FETCH_TIMEOUT_MS` and settles on the
 * failure branch instead of hanging forever.
 */

import type { AvailabilityMap } from "./availability.ts";
import {
  availabilityTtlMs,
  fetchTimeoutMs,
} from "./config.ts";

/**
 * How long a confirmed stock number may be displayed. Default 60s (the
 * commitment 5b bound), env-tunable via NEXT_PUBLIC_AVAILABILITY_TTL_MS
 * within 1s..60s (ENV-01 operational knob; the 60s cap IS the 5b bound,
 * so the knob can only tighten it, never loosen it).
 */
export const CONFIRMED_TTL_MS = availabilityTtlMs();

/**
 * Hard timeout for one availability request (client route fetch and the
 * server-side API client): a stalled request is aborted and treated as a
 * failure instead of hanging. Default 10s, env-tunable via
 * NEXT_PUBLIC_FETCH_TIMEOUT_MS (100ms..120s).
 *
 * Browser wiring (ENV-01): Next inlines only statically named public env
 * accesses into client bundles, so the client-side values are resolved on
 * the SERVER (lib/config.ts) and passed down as props through the provider
 * (components/availability-context.tsx); the browser never reads env itself.
 */
export const FETCH_TIMEOUT_MS = fetchTimeoutMs();

/** Events that re-check freshness (and may trigger a refresh). */
export type Trigger = "mount" | "navigate" | "visibility-visible" | "tick";

/** What one fetch attempt confirmed (or failed to confirm). */
export type FetchOutcome =
  | { kind: "confirmed"; map: AvailabilityMap }
  | { kind: "failed" };

/** Shared fail-closed outcome; safe to compare or reuse. */
export const FETCH_FAILED: FetchOutcome = Object.freeze({ kind: "failed" });

/** The last fetch result, as recorded by the lifecycle. */
export type LastResult = FetchOutcome | { kind: "none" };

/**
 * What the lifecycle knows: the last fetch result plus, when it was a
 * confirmation, the time that confirmation happened.
 */
export type LifecycleRecord = {
  result: LastResult;
  /** ms-epoch of the confirmation behind `result`; null unless confirmed. */
  confirmedAt: number | null;
};

/** The state the badge should render right now. Only "confirmed" carries a number. */
export type DesiredState =
  | { status: "confirming" }
  | { status: "confirmed"; map: AvailabilityMap }
  | { status: "unconfirmed" };

/** The next desired state plus whether a fetch should be started. */
export type LifecycleDecision = { state: DesiredState; fetch: boolean };

/** Nothing fetched, nothing confirmed: the number-free placeholder. */
export const INITIAL_RECORD: LifecycleRecord = Object.freeze({
  result: { kind: "none" as const },
  confirmedAt: null,
});

/**
 * Is the confirmation behind `confirmedAt` still displayable at `now`?
 * Fresh strictly under `ttlMs` (default CONFIRMED_TTL_MS): at the TTL
 * boundary the number is already stale (fail-closed).
 */
export function isFresh(
  now: number,
  confirmedAt: number | null,
  ttlMs: number = CONFIRMED_TTL_MS,
): boolean {
  if (confirmedAt === null) return false;
  const elapsed = now - confirmedAt;
  // Fail-closed on clock rollback: negative elapsed is treated as stale (a
  // refetch follows), never as extra freshness. The default clock is
  // performance.now(), which is monotonic, so this is a defensive net.
  return elapsed >= 0 && elapsed < ttlMs;
}

/**
 * The desired display state for a record at a point in time. Pure render-time
 * gate: a number is displayable only while its confirmation is fresh.
 */
export function desiredState(
  record: LifecycleRecord,
  now: number,
  ttlMs: number = CONFIRMED_TTL_MS,
): DesiredState {
  if (record.result.kind === "confirmed") {
    return isFresh(now, record.confirmedAt, ttlMs)
      ? { status: "confirmed", map: record.result.map }
      : { status: "confirming" };
  }
  return record.result.kind === "failed"
    ? { status: "unconfirmed" }
    : { status: "confirming" };
}

/**
 * Pure transition core: given (now, lastConfirmedAt, lastResult, trigger),
 * return the next desired state plus whether to fetch.
 *
 * Fetch policy (one freshness gate for every trigger kind):
 * - "mount" always reconfirms (a provider starts with nothing confirmed).
 * - every other trigger refetches only when data is absent or stale.
 * The desired display never shows a number past its TTL: stale confirmed data
 * falls back to "confirming" while the refresh runs.
 */
export function nextLifecycle(input: {
  now: number;
  trigger: Trigger;
  lastConfirmedAt: number | null;
  lastResult: LastResult;
  ttlMs?: number;
}): LifecycleDecision {
  const ttlMs = input.ttlMs ?? CONFIRMED_TTL_MS;
  const record: LifecycleRecord = {
    result: input.lastResult,
    confirmedAt: input.lastConfirmedAt,
  };
  const fetch =
    input.trigger === "mount" ||
    input.lastResult.kind !== "confirmed" ||
    !isFresh(input.now, input.lastConfirmedAt, ttlMs);
  return { state: desiredState(record, input.now, ttlMs), fetch };
}

/**
 * Fold one settled fetch into a record. Confirmed records the map with a fresh
 * `confirmedAt`; a failure records nothing confirmed: number-free (fail-closed,
 * commitment 5b). The previous record never survives a failed refresh.
 */
export function applyFetchOutcome(
  outcome: FetchOutcome,
  now: number,
): LifecycleRecord {
  return outcome.kind === "confirmed"
    ? { result: { kind: "confirmed", map: outcome.map }, confirmedAt: now }
    : { result: FETCH_FAILED, confirmedAt: null };
}

/**
 * Defensive parse of the /api/availability payload. A count we cannot make
 * sense of is not a count we can confirm, and one bad entry poisons the whole
 * payload. Returns null when nothing is confirmable.
 */
export function parseAvailabilityPayload(body: unknown): AvailabilityMap | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const { ok, availability } = body as { ok?: unknown; availability?: unknown };
  if (ok !== true) return null;
  if (
    typeof availability !== "object" ||
    availability === null ||
    Array.isArray(availability)
  ) {
    return null;
  }
  const map: AvailabilityMap = new Map();
  for (const [slug, available] of Object.entries(availability)) {
    if (
      slug.length === 0 ||
      typeof available !== "number" ||
      !Number.isInteger(available) ||
      available < 0
    ) {
      return null;
    }
    map.set(slug, available);
  }
  return map;
}

/**
 * Module-level in-flight request, shared by every badge on the page (and by
 * React StrictMode's double-invoked effects). Cleared the moment it settles,
 * success or failure: the dedupe key is "a request is in flight right now",
 * never a fulfilled result.
 */
let sharedRequest: Promise<FetchOutcome> | null = null;

/**
 * Run `fetchAvailability`, deduplicating concurrent callers onto one request.
 * A rejected fetch is folded into the fail-closed outcome, so the returned
 * promise never rejects.
 */
export function fetchAvailabilityOnce(
  fetchAvailability: () => Promise<FetchOutcome>,
): Promise<FetchOutcome> {
  if (sharedRequest === null) {
    const request = (async (): Promise<FetchOutcome> => {
      try {
        return await fetchAvailability();
      } catch {
        return FETCH_FAILED;
      }
    })();
    sharedRequest = request;
    const clear = (): void => {
      if (sharedRequest === request) sharedRequest = null;
    };
    void request.then(clear, clear);
  }
  return sharedRequest;
}

/** The subset of fetch this module needs (injectable for tests). */
export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<{ status: number; json(): Promise<unknown> }>;

/**
 * The real client fetcher for /api/availability: no-store, 200-only, one
 * parse, and an explicit AbortController timeout so a stalled request reaches
 * the failure branch instead of hanging forever. Never throws.
 */
export function createRouteFetcher(options?: {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  url?: string;
}): () => Promise<FetchOutcome> {
  const fetchImpl: FetchLike =
    options?.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const url = options?.url ?? "/api/availability";
  return async (): Promise<FetchOutcome> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      // Only a confirmed 200 carries stock data.
      if (response.status !== 200) return FETCH_FAILED;
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return FETCH_FAILED;
      }
      const map = parseAvailabilityPayload(body);
      return map === null ? FETCH_FAILED : { kind: "confirmed", map };
    } catch {
      // Network failure, abort timeout, or any unexpected runtime error.
      return FETCH_FAILED;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Opaque handle returned by the injected timer scheduler. */
export type TimerHandle = unknown;

/** Injectable session dependencies (tests mock the fetch, clock and timers). */
export type SessionDeps = {
  fetchAvailability?: () => Promise<FetchOutcome>;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
  /** Confirmation TTL override (the server-resolved env knob). */
  ttlMs?: number;
};

/** The lifecycle session the React provider wraps. */
export type AvailabilitySession = {
  /** What the lifecycle currently knows (recorded state). */
  getRecord(): LifecycleRecord;
  /** The desired display state, freshness-checked at `now` (default: clock). */
  desiredAt(now?: number): DesiredState;
  /** Notified whenever the desired display state changes. */
  subscribe(listener: () => void): () => void;
  /** Feed one lifecycle event (mount / navigate / visibility-visible / tick). */
  trigger(trigger: Trigger): void;
  /**
   * Stop the session (provider unmount): cancel the TTL timer and drop any
   * late settlement so a stopped session never re-arms or notifies. A
   * later trigger("mount") restarts the session, which is exactly what
   * React StrictMode's setup/cleanup/setup replay needs on the same
   * component instance.
   */
  stop(): void;
};

function sameState(a: DesiredState, b: DesiredState): boolean {
  return (
    a.status === b.status &&
    (a.status !== "confirmed" || b.status !== "confirmed" || a.map === b.map)
  );
}

/**
 * Build a session: record + desired state + in-flight dedupe + the TTL timer.
 * All side effects go through the injected dependencies; the defaults are the
 * browser fetch, performance.now() (monotonic, so wall-clock rollback cannot
 * extend freshness) and setTimeout.
 */
export function createAvailabilitySession(
  deps: SessionDeps = {},
): AvailabilitySession {
  const fetchAvailability =
    deps.fetchAvailability ?? createRouteFetcher();
  const ttlMs = deps.ttlMs ?? CONFIRMED_TTL_MS;
  const now =
    deps.now ??
    (() =>
      typeof performance !== "undefined" ? performance.now() : Date.now());
  const schedule =
    deps.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel =
    deps.cancel ??
    ((handle: TimerHandle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));

  let record: LifecycleRecord = INITIAL_RECORD;
  let state: DesiredState = desiredState(record, now(), ttlMs);
  const listeners = new Set<() => void>();
  /** A settle handler is attached to the shared request for this cycle. */
  let settling = false;
  let timer: TimerHandle = null;
  /** stop() parks the session until a later trigger("mount") restarts it. */
  let stopped = false;

  function notify(): void {
    for (const listener of [...listeners]) listener();
  }

  function setState(next: DesiredState): void {
    if (sameState(state, next)) return;
    state = next;
    notify();
  }

  /**
   * Keep exactly one TTL timer armed while the record holds a fresh
   * confirmation. Once stale (or unconfirmed) no timer is needed: the fetch
   * path owns the refresh, which re-arms on settle.
   */
  function rearm(): void {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    if (stopped) return;
    if (record.result.kind !== "confirmed" || record.confirmedAt === null) {
      return;
    }
    const delay = record.confirmedAt + ttlMs - now();
    if (delay <= 0) return;
    timer = schedule(() => {
      timer = null;
      trigger("tick");
    }, delay);
  }

  function trigger(event: Trigger): void {
    if (stopped) {
      // Only a mount restarts a stopped session (StrictMode replay / remount);
      // anything else that somehow reaches a parked session is ignored.
      if (event !== "mount") return;
      stopped = false;
    }
    const decision = nextLifecycle({
      now: now(),
      trigger: event,
      lastConfirmedAt: record.confirmedAt,
      lastResult: record.result,
      ttlMs,
    });
    setState(decision.state);
    if (decision.fetch && !settling) {
      settling = true;
      void fetchAvailabilityOnce(fetchAvailability).then((outcome) => {
        settling = false;
        // A provider unmounted while its request was in flight: the late
        // settlement must not mutate, notify or re-arm.
        if (stopped) return;
        record = applyFetchOutcome(outcome, now());
        setState(desiredState(record, now(), ttlMs));
        rearm();
      });
    }
    rearm();
  }

  return {
    getRecord: () => record,
    desiredAt: (at?: number) => desiredState(record, at ?? now(), ttlMs),
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    trigger,
    stop(): void {
      stopped = true;
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
    },
  };
}

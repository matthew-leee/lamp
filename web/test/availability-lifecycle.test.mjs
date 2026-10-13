/*
  Unit tests for the pure client-side availability lifecycle
  (lib/availability-lifecycle.ts). No DOM, no network: the fetch, clock and
  timer scheduler are injected and mocked per test (review finding 2,
  T3-rework-2). The SSR/route suites (test/pages.test.mjs,
  test/routes.test.mjs) are untouched.

  Full lifecycle covered (review finding 2):
  - initial load -> confirmed positive; confirmed zero; slug missing from a
    confirmed map; malformed payload; network/503 failure
  - confirmed -> TTL expiry -> auto-refresh success (new number)
  - confirmed -> TTL expiry -> refresh failure -> unconfirmed (number-free)
  - navigation trigger with fresh data (no refetch) vs stale data (refetch)
  - visibility resume (fresh: no refetch; stale/absent: refetch; recovery
    after a failure)
  - in-flight dedupe: two triggers share one fetch, and a settled request is
    never reused as the dedupe key (success and failure both clear it)
  - failure on mount -> unconfirmed
  - provider mount always reconfirms; freshness constants are exported; the
    client route fetch aborts a stalled request at the timeout

  Badge rendering is asserted through lib/stock.ts decideStock(), exactly as
  components/stock-badge.tsx consumes the state (a DOM-free stand-in for the
  rendered badge).
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONFIRMED_TTL_MS,
  FETCH_TIMEOUT_MS,
  INITIAL_RECORD,
  applyFetchOutcome,
  createAvailabilitySession,
  createRouteFetcher,
  desiredState,
  isFresh,
  nextLifecycle,
} from "../lib/availability-lifecycle.ts";
import { decideStock } from "../lib/stock.ts";

/** One macrotask: flushes every pending microtask (settle handlers). */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Session harness: fake clock (advanceTo), fake timers (runTimers), and a
 * fetcher whose calls are counted and whose outcomes are resolved manually.
 */
function harness() {
  let now = 0;
  const pending = [];
  const timers = [];
  const session = createAvailabilitySession({
    fetchAvailability: () => {
      const d = deferred();
      pending.push(d);
      return d.promise;
    },
    now: () => now,
    schedule: (callback, delayMs) => {
      const handle = { callback, delayMs, cancelled: false };
      timers.push(handle);
      return handle;
    },
    cancel: (handle) => {
      handle.cancelled = true;
    },
  });
  return {
    session,
    fetchCalls: () => pending.length,
    /** Resolve the nth (0-based) started fetch. */
    settle(n, outcome) {
      assert.ok(pending[n], `no fetch #${n} was started`);
      pending[n].resolve(outcome);
    },
    advanceTo(t) {
      now = t;
    },
    /** Fire every timer armed since the last runTimers() call. */
    runTimers() {
      for (const handle of timers.splice(0)) {
        if (!handle.cancelled) {
          handle.cancelled = true;
          handle.callback();
        }
      }
    },
    armedTimers: () => timers.filter((t) => !t.cancelled),
  };
}

/** What components/stock-badge.tsx would render for one SKU. */
function badge(desired, slug, unitsInDrop) {
  return decideStock(
    desired.status === "confirmed" ? desired.map : null,
    slug,
    unitsInDrop,
  );
}

const confirmed = (map) => ({ kind: "confirmed", map });
const FAILED = { kind: "failed" };

/* ---------------------------------------------------------------- */
/* Constants and the pure transition core                            */
/* ---------------------------------------------------------------- */

test("freshness constants are exported and match the commitment bound", () => {
  assert.equal(CONFIRMED_TTL_MS, 60_000);
  assert.equal(FETCH_TIMEOUT_MS, 10_000);
});

test("pure core: a number is displayable strictly under the 60s TTL", () => {
  assert.equal(isFresh(59_999, 0), true);
  assert.equal(isFresh(60_000, 0), false, "at exactly 60s the number is stale");
  assert.equal(isFresh(1, null), false, "nothing confirmed is never fresh");

  const record = applyFetchOutcome(confirmed(new Map([["a", 1]])), 1_000);
  assert.equal(record.confirmedAt, 1_000);
  const fresh = desiredState(record, 1_000 + CONFIRMED_TTL_MS - 1);
  assert.equal(fresh.status, "confirmed");
  const stale = desiredState(record, 1_000 + CONFIRMED_TTL_MS);
  assert.equal(stale.status, "confirming", "stale data falls back to confirming");
  assert.equal("map" in stale, false, "the stale state carries no map");
});

test("pure core: trigger policy (mount reconfirms, others gate on freshness)", () => {
  const map = new Map([["a", 1]]);
  const fresh = {
    now: 1_000,
    lastConfirmedAt: 1_000,
    lastResult: confirmed(map),
  };

  // Mount always reconfirms, even with fresh data on hand.
  assert.deepEqual(nextLifecycle({ ...fresh, trigger: "mount" }), {
    state: { status: "confirmed", map },
    fetch: true,
  });
  // Navigation with fresh data: no refetch, number stays.
  assert.deepEqual(nextLifecycle({ ...fresh, trigger: "navigate" }), {
    state: { status: "confirmed", map },
    fetch: false,
  });
  // Visibility with fresh data: no refetch.
  assert.equal(
    nextLifecycle({ ...fresh, trigger: "visibility-visible" }).fetch,
    false,
  );

  // Stale data on any trigger: back to the number-free confirming state + refetch.
  for (const trigger of ["navigate", "visibility-visible", "tick"]) {
    const decision = nextLifecycle({
      now: 1_000 + CONFIRMED_TTL_MS,
      trigger,
      lastConfirmedAt: 1_000,
      lastResult: confirmed(map),
    });
    assert.equal(decision.fetch, true, `${trigger} must refetch when stale`);
    assert.deepEqual(decision.state, { status: "confirming" });
  }

  // Nothing confirmed yet (initial load): confirming + fetch.
  assert.deepEqual(
    nextLifecycle({
      now: 0,
      trigger: "mount",
      lastConfirmedAt: null,
      lastResult: { kind: "none" },
    }),
    { state: { status: "confirming" }, fetch: true },
  );

  // A previous failure: unconfirmed (number-free) + any trigger refetches.
  for (const trigger of ["mount", "navigate", "visibility-visible"]) {
    const decision = nextLifecycle({
      now: 5_000,
      trigger,
      lastConfirmedAt: null,
      lastResult: FAILED,
    });
    assert.deepEqual(decision.state, { status: "unconfirmed" });
    assert.equal(decision.fetch, true);
  }
});

test("applyFetchOutcome: confirmation records a timestamp, failure wipes the record", () => {
  const map = new Map([["a", 3]]);
  const ok = applyFetchOutcome(confirmed(map), 42_000);
  assert.deepEqual(ok, {
    result: { kind: "confirmed", map },
    confirmedAt: 42_000,
  });
  // A failure never retains the old number (fail-closed).
  const failed = applyFetchOutcome(FAILED, 43_000);
  assert.equal(failed.result.kind, "failed");
  assert.equal(failed.confirmedAt, null);
  assert.deepEqual(failed, {
    result: FAILED,
    confirmedAt: null,
  });
});

/* ---------------------------------------------------------------- */
/* Full stack (route fetcher -> parse -> lifecycle -> badge)          */
/* ---------------------------------------------------------------- */

function routeResponse(status, body) {
  return { status, json: async () => body };
}

async function mountWithRoutePayload(fetchImpl, slug, unitsInDrop) {
  const session = createAvailabilitySession({
    fetchAvailability: createRouteFetcher({ fetchImpl }),
    now: () => 0,
    schedule: () => null,
    cancel: () => {},
  });
  session.trigger("mount");
  await tick();
  return { session, state: session.desiredAt(), badge: badge(session.desiredAt(), slug, unitsInDrop) };
}

test("initial load -> confirmed positive shows the confirmed number", async () => {
  const { state, badge: b } = await mountWithRoutePayload(
    async () => routeResponse(200, { ok: true, availability: { "ph-3-2": 2 } }),
    "ph-3-2",
    1,
  );
  assert.equal(state.status, "confirmed");
  assert.deepEqual(state.map, new Map([["ph-3-2", 2]]));
  assert.deepEqual(b, { kind: "left", n: 2 });
});

test("initial load -> confirmed zero renders sold out, not a number", async () => {
  const { badge: b } = await mountWithRoutePayload(
    async () => routeResponse(200, { ok: true, availability: { "ph-3-2": 0 } }),
    "ph-3-2",
    1,
  );
  assert.deepEqual(b, { kind: "soldout" });
});

test("slug missing from a confirmed map is unconfirmed for that SKU", async () => {
  const { state, badge: b } = await mountWithRoutePayload(
    async () => routeResponse(200, { ok: true, availability: { other: 4 } }),
    "ph-3-2",
    1,
  );
  assert.equal(state.status, "confirmed", "the payload itself was confirmed");
  assert.deepEqual(b, { kind: "unconfirmed" }, "but nothing is confirmed for this slug");
});

test("malformed payload settles fail-closed (unconfirmed, number-free)", async () => {
  const bodies = [
    { ok: true }, // availability missing
    { ok: true, availability: null },
    { ok: true, availability: [] },
    { ok: true, availability: { a: -1 } },
    { ok: true, availability: { a: 1.5 } },
    { ok: true, availability: { a: "2" } },
    { ok: true, availability: { "": 2 } },
    { ok: false, availability: { a: 2 } },
    [1, 2, 3],
    "not an object",
  ];
  for (const body of bodies) {
    const { state, badge: b } = await mountWithRoutePayload(
      async () => routeResponse(200, body),
      "a",
      1,
    );
    assert.equal(state.status, "unconfirmed", `payload ${JSON.stringify(body)}`);
    assert.equal("map" in state, false);
    assert.deepEqual(b, { kind: "unconfirmed" });
  }
});

test("network failure and 503 settle unconfirmed (number-free)", async () => {
  const fetchImpls = {
    "network failure": async () => {
      throw new TypeError("fetch failed");
    },
    "upstream 503": async () => routeResponse(503, { ok: false }),
  };
  for (const [label, fetchImpl] of Object.entries(fetchImpls)) {
    const { state, badge: b } = await mountWithRoutePayload(fetchImpl, "a", 1);
    assert.equal(state.status, "unconfirmed", label);
    assert.equal("map" in state, false, label);
    assert.deepEqual(b, { kind: "unconfirmed" }, label);
  }
});

test("client route fetch aborts a stalled request at the timeout (failure branch)", async () => {
  const stalled = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () =>
        reject(new Error("request aborted")),
      );
    });
  const fetchRoute = createRouteFetcher({ fetchImpl: stalled, timeoutMs: 15 });

  const started = Date.now();
  const outcome = await fetchRoute();
  assert.equal(outcome.kind, "failed", "a hang must settle on the failure branch");
  assert.ok(
    Date.now() - started < 5_000,
    "the stalled request must be aborted by the timeout, not awaited forever",
  );

  // The timeout is explicit and injectable: the shipped default is 10s.
  assert.equal(FETCH_TIMEOUT_MS, 10_000);
});

/* ---------------------------------------------------------------- */
/* Session lifecycle with mocked fetch + clock                       */
/* ---------------------------------------------------------------- */

test("confirmed -> TTL expiry -> auto-refresh success (new number)", async () => {
  const h = harness();
  h.session.trigger("mount");
  assert.equal(h.fetchCalls(), 1);

  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();
  assert.deepEqual(badge(h.session.desiredAt(), "a", 1), { kind: "left", n: 2 });

  // The TTL timer is armed at the confirmation TTL.
  const armed = h.armedTimers();
  assert.equal(armed.length, 1);
  assert.equal(armed[0].delayMs, CONFIRMED_TTL_MS);

  // At expiry the badge drops to the number-free confirming state...
  h.advanceTo(CONFIRMED_TTL_MS);
  h.runTimers();
  assert.equal(h.session.desiredAt().status, "confirming");
  assert.equal("map" in h.session.desiredAt(), false);

  // ...and the auto-refresh lands with the new number.
  assert.equal(h.fetchCalls(), 2);
  h.settle(1, confirmed(new Map([["a", 5]])));
  await tick();
  assert.deepEqual(badge(h.session.desiredAt(), "a", 1), { kind: "left", n: 5 });
});

test("confirmed -> TTL expiry -> refresh failure -> unconfirmed (number-free)", async () => {
  const h = harness();
  h.session.trigger("mount");
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();

  h.advanceTo(CONFIRMED_TTL_MS);
  h.runTimers();
  assert.equal(h.session.desiredAt().status, "confirming");

  h.settle(1, FAILED);
  await tick();
  const state = h.session.desiredAt();
  assert.equal(state.status, "unconfirmed");
  assert.equal("map" in state, false, "a failed refresh leaves no number behind");
  assert.deepEqual(badge(state, "a", 1), { kind: "unconfirmed" });
});

test("navigation trigger: fresh data does not refetch, stale data refetches", async () => {
  const h = harness();
  h.session.trigger("mount");
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();

  // Fresh: no refetch, the number stays.
  h.advanceTo(10_000);
  h.session.trigger("navigate");
  await tick();
  assert.equal(h.fetchCalls(), 1, "navigation with fresh data must not refetch");
  assert.deepEqual(badge(h.session.desiredAt(), "a", 1), { kind: "left", n: 2 });

  // Stale: back to confirming + refetch.
  h.advanceTo(CONFIRMED_TTL_MS + 1);
  h.session.trigger("navigate");
  assert.equal(h.session.desiredAt().status, "confirming");
  assert.equal(h.fetchCalls(), 2, "navigation with stale data must refetch");
  h.settle(1, confirmed(new Map([["a", 3]])));
  await tick();
  assert.deepEqual(badge(h.session.desiredAt(), "a", 1), { kind: "left", n: 3 });
});

test("visibility resume: fresh data is not refetched", async () => {
  const h = harness();
  h.session.trigger("mount");
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();

  h.advanceTo(5_000);
  h.session.trigger("visibility-visible");
  await tick();
  assert.equal(h.fetchCalls(), 1);
  assert.equal(h.session.desiredAt().status, "confirmed");
});

test("visibility resume: stale or absent data is refetched and can recover", async () => {
  const h = harness();

  // Absent (e.g. the first fetch failed on mount): the resume refetches.
  h.session.trigger("mount");
  h.settle(0, FAILED);
  await tick();
  assert.equal(h.session.desiredAt().status, "unconfirmed");

  h.advanceTo(1_000);
  h.session.trigger("visibility-visible");
  assert.equal(h.fetchCalls(), 2, "resume with nothing confirmed must refetch");
  h.settle(1, confirmed(new Map([["a", 1]])));
  await tick();
  assert.deepEqual(badge(h.session.desiredAt(), "a", 1), { kind: "left", n: 1 });

  // Stale: the resume refetches again.
  h.advanceTo(1_000 + CONFIRMED_TTL_MS + 1);
  h.session.trigger("visibility-visible");
  assert.equal(h.fetchCalls(), 3, "resume with stale data must refetch");
  h.settle(2, confirmed(new Map([["a", 4]])));
  await tick();
  assert.deepEqual(badge(h.session.desiredAt(), "a", 1), { kind: "left", n: 4 });
});

test("in-flight dedupe: two triggers share one fetch", async () => {
  const h = harness();
  h.session.trigger("mount");
  h.session.trigger("navigate");
  h.session.trigger("visibility-visible");
  assert.equal(h.fetchCalls(), 1, "all triggers must share the in-flight request");

  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();
  assert.deepEqual(badge(h.session.desiredAt(), "a", 1), { kind: "left", n: 2 });
});

test("dedupe is in-flight only: settled requests are never reused", async () => {
  const h = harness();

  // Success clears the dedupe key: the TTL-expiry trigger fetches again.
  h.session.trigger("mount");
  assert.equal(h.fetchCalls(), 1);
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();
  h.advanceTo(CONFIRMED_TTL_MS);
  h.runTimers();
  assert.equal(h.fetchCalls(), 2, "after a settled success the next trigger refetches");
  h.settle(1, confirmed(new Map([["a", 2]])));
  await tick();

  // Failure clears it too.
  h.advanceTo(2 * CONFIRMED_TTL_MS);
  h.runTimers();
  assert.equal(h.fetchCalls(), 3);
  h.settle(2, FAILED);
  await tick();
  h.session.trigger("visibility-visible");
  assert.equal(h.fetchCalls(), 4, "after a settled failure the next trigger refetches");
  h.settle(3, confirmed(new Map([["a", 1]])));
  await tick();
  assert.equal(h.session.desiredAt().status, "confirmed");
});

test("failure on mount -> unconfirmed (number-free), no retry storm", async () => {
  const h = harness();
  h.session.trigger("mount");
  h.settle(0, FAILED);
  await tick();

  const state = h.session.desiredAt();
  assert.equal(state.status, "unconfirmed");
  assert.equal("map" in state, false);
  assert.deepEqual(badge(state, "a", 1), { kind: "unconfirmed" });
  // A failed mount schedules no TTL timer: only triggers drive a retry.
  assert.equal(h.armedTimers().length, 0);
});

test("mount always reconfirms, even with fresh data (session level)", async () => {
  const h = harness();
  h.session.trigger("mount");
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();

  h.advanceTo(1_000);
  h.session.trigger("mount");
  assert.equal(h.fetchCalls(), 2, "a mount reconfirms regardless of freshness");
  h.settle(1, confirmed(new Map([["a", 7]])));
  await tick();
  assert.deepEqual(badge(h.session.desiredAt(), "a", 1), { kind: "left", n: 7 });
});

test("subscribe notifies exactly when the desired display state changes", async () => {
  const h = harness();
  let notifications = 0;
  const unsubscribe = h.session.subscribe(() => {
    notifications += 1;
  });

  h.session.trigger("mount"); // confirming -> same as initial: no change yet
  assert.equal(notifications, 0);
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();
  assert.equal(notifications, 1, "confirming -> confirmed notifies once");

  h.advanceTo(1_000);
  h.session.trigger("navigate"); // fresh: no state change
  assert.equal(notifications, 1);

  h.advanceTo(CONFIRMED_TTL_MS);
  h.runTimers(); // confirmed -> confirming notifies
  assert.equal(notifications, 2);
  h.settle(1, FAILED);
  await tick(); // confirming -> unconfirmed notifies
  assert.equal(notifications, 3);

  unsubscribe();
  h.session.trigger("visibility-visible"); // refetch -> settle: no listener
  h.settle(2, confirmed(new Map([["a", 1]])));
  await tick();
  assert.equal(notifications, 3, "an unsubscribed listener is never called");
});

test("the initial record is the number-free placeholder", () => {
  assert.deepEqual(INITIAL_RECORD, { result: { kind: "none" }, confirmedAt: null });
  assert.deepEqual(desiredState(INITIAL_RECORD, 0), { status: "confirming" });
});

/* ---------------------------------------------------------------- */
/* Round 4 (review send-back): stop/cleanup, rollback, remount       */
/* ---------------------------------------------------------------- */

test("stop after a confirmation cancels the TTL timer and ends fetching", async () => {
  const h = harness();
  h.session.trigger("mount");
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();
  assert.equal(h.armedTimers().length, 1, "fresh confirmation arms the TTL timer");

  h.session.stop();
  assert.equal(h.armedTimers().length, 0, "stop cancels the armed timer");

  h.advanceTo(10 * CONFIRMED_TTL_MS);
  h.runTimers();
  assert.equal(h.fetchCalls(), 1, "a stopped session never fetches again");
});

test("unmount during a fetch: the late settlement is dropped, never re-arms", async () => {
  const h = harness();
  let notifications = 0;
  h.session.subscribe(() => notifications++);
  h.session.trigger("mount");
  assert.equal(h.fetchCalls(), 1);

  h.session.stop();
  // Baseline BEFORE the late settlement: any notify during it must be caught.
  const before = notifications;
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();

  assert.equal(notifications, before,
    "the late settlement must not notify a stopped session");
  assert.equal(h.session.desiredAt().status, "confirming",
    "the late settle must not confirm a stopped session");
  assert.equal(h.armedTimers().length, 0, "the late settle must not re-arm");
  h.advanceTo(10 * CONFIRMED_TTL_MS);
  h.runTimers();
  assert.equal(notifications, before, "a stopped session stays silent");
  assert.equal(h.fetchCalls(), 1);

  // Non-mount triggers are ignored while parked.
  h.session.trigger("navigate");
  h.session.trigger("visibility-visible");
  assert.equal(h.fetchCalls(), 1);
});

test("StrictMode replay: mount -> stop -> mount while the request is pending", async () => {
  const h = harness();
  h.session.trigger("mount");
  assert.equal(h.fetchCalls(), 1);

  // Immediate cleanup + second setup, the request still in flight.
  h.session.stop();
  h.session.trigger("mount");
  assert.equal(h.fetchCalls(), 1,
    "replay must not start a second request (in-flight dedupe)");

  let notifications = 0;
  h.session.subscribe(() => notifications++);
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();

  assert.equal(h.session.desiredAt().status, "confirmed",
    "the pending request confirms the replayed session");
  assert.ok(notifications > 0,
    "the re-attached subscriber is notified on settle");
  assert.equal(h.armedTimers().length, 1,
    "exactly one TTL timer is armed after the replayed confirmation");
});

test("cross-session: a stopped session's settled result is not reused by a remount", async () => {
  const h1 = harness();
  h1.session.trigger("mount");
  h1.settle(0, confirmed(new Map([["a", 2]])));
  await tick();
  assert.equal(h1.session.desiredAt().status, "confirmed");

  // A unmounts; a new session B mounts (the provider remount path).
  let h1Notifications = 0;
  h1.session.subscribe(() => h1Notifications++);
  h1.session.stop();

  const h2 = harness();
  h2.session.trigger("mount");
  assert.equal(h2.fetchCalls(), 1,
    "the remount issues a NEW underlying request (settled results are never reused)");
  h2.settle(0, confirmed(new Map([["a", 9]])));
  await tick();

  assert.deepEqual(badge(h2.session.desiredAt(), "a", 1), { kind: "left", n: 9 },
    "the remount sees the fresh map, not the stopped session's");
  // The stopped session's record is inert: nothing renders it after unmount,
  // and it must never fetch, notify or arm again.
  assert.equal(h1.fetchCalls(), 1,
    "the stopped session never fetches again");
  assert.equal(h1.armedTimers().length, 0,
    "the stopped session stays timer-free");
  assert.equal(h1Notifications, 0,
    "the stopped session never notifies again");
  h1.session.trigger("navigate");
  assert.equal(h1.fetchCalls(), 1, "parked triggers are ignored");
});

test("stop then mount restarts the session (StrictMode setup/cleanup/setup)", async () => {
  const h = harness();
  h.session.trigger("mount");
  h.session.stop(); // StrictMode cleanup
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick(); // dropped: stopped

  h.session.trigger("mount"); // StrictMode second setup
  assert.equal(h.fetchCalls(), 2, "a mount restarts a parked session");
  h.settle(1, confirmed(new Map([["a", 5]])));
  await tick();
  assert.deepEqual(badge(h.session.desiredAt(), "a", 1), { kind: "left", n: 5 });
});

test("concurrent sessions share one in-flight request (cross-session dedupe)", async () => {
  const h1 = harness();
  const h2 = harness();
  // fetchAvailabilityOnce dedupes module-wide: h2's trigger joins h1's request.
  h1.session.trigger("mount");
  h2.session.trigger("mount");
  assert.equal(h1.fetchCalls() + h2.fetchCalls(), 1,
    "two sessions, one underlying request");

  h1.settle(0, confirmed(new Map([["a", 3]])));
  await tick();
  assert.equal(h1.session.desiredAt().status, "confirmed");
  // h2 attached its own settle handler to the shared request.
  assert.equal(h2.session.desiredAt().status, "confirmed");
});

test("stopping one session does not disrupt another session's shared request", async () => {
  const h1 = harness();
  const h2 = harness();
  h1.session.trigger("mount");
  h2.session.trigger("mount");
  h1.session.stop(); // h1 unmounts while the shared request is in flight
  h1.settle(0, confirmed(new Map([["a", 4]])));
  await tick();

  assert.equal(h1.session.desiredAt().status, "confirming",
    "stopped session drops the settlement");
  assert.equal(h2.session.desiredAt().status, "confirmed",
    "the surviving session still receives the shared result");
  assert.equal(h1.armedTimers().length + h2.armedTimers().length, 1,
    "only the surviving session arms a timer");
});

test("wall-clock rollback cannot extend freshness (fail-closed)", async () => {
  const h = harness();
  h.session.trigger("mount");
  h.advanceTo(5_000);
  h.settle(0, confirmed(new Map([["a", 2]])));
  await tick();
  assert.equal(h.session.desiredAt().status, "confirmed");

  // Device clock jumps backwards: negative elapsed must read as stale.
  h.advanceTo(1_000);
  assert.equal(isFresh(1_000, 5_000), false, "negative elapsed is not fresh");
  assert.equal(h.session.desiredAt().status, "confirming",
    "the number disappears instead of gaining infinite freshness");

  h.session.trigger("navigate");
  assert.equal(h.fetchCalls(), 2, "a trigger after rollback refetches");
});

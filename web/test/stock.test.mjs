/*
  Pure unit tests for the stock display decision (lib/stock.ts). No server and
  no network.

  Contract asserted (Vision.md TRUST-02, commitment 5b: never display a stock
  count that cannot be confirmed):
  - null map -> unconfirmed
  - slug absent from the map -> unconfirmed
  - available 0 -> soldout
  - available n > 0 -> left n, exactly n
  - a value that is not a non-negative integer count -> unconfirmed
  - the unconfirmed state carries no number at all
*/

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideStock, UNCONFIRMED } from "../lib/stock.ts";

const units = 2;

test("null availability map -> unconfirmed", () => {
  assert.deepEqual(decideStock(null, "panthella-160-v3-beige", units), {
    kind: "unconfirmed",
  });
});

test("slug absent from a confirmed map -> unconfirmed", () => {
  const map = new Map([["other-slug", 3]]);
  assert.deepEqual(decideStock(map, "panthella-160-v3-beige", units), {
    kind: "unconfirmed",
  });
});

test("empty map (nothing covered) -> unconfirmed", () => {
  assert.deepEqual(decideStock(new Map(), "panthella-160-v3-beige", units), {
    kind: "unconfirmed",
  });
});

test("available 0 -> soldout", () => {
  const map = new Map([["panthella-160-v3-beige", 0]]);
  assert.deepEqual(decideStock(map, "panthella-160-v3-beige", units), {
    kind: "soldout",
  });
});

test("available n > 0 -> left n, exactly the confirmed count", () => {
  const map = new Map([["panthella-160-v3-beige", 3]]);
  assert.deepEqual(decideStock(map, "panthella-160-v3-beige", units), {
    kind: "left",
    n: 3,
  });
});

test("available 1 -> left 1 (the last piece is still a count, not a sale)", () => {
  const map = new Map([["ph-3-2-table-chrome", 1]]);
  assert.deepEqual(decideStock(map, "ph-3-2-table-chrome", 1), {
    kind: "left",
    n: 1,
  });
});

test("correct slug is read even with several SKUs in the map", () => {
  const map = new Map([
    ["panthella-160-v3-beige", 2],
    ["ph-2-1-table-chrome", 0],
  ]);
  assert.deepEqual(decideStock(map, "panthella-160-v3-beige", units), {
    kind: "left",
    n: 2,
  });
  assert.deepEqual(decideStock(map, "ph-2-1-table-chrome", 3), {
    kind: "soldout",
  });
});

test("negative count -> unconfirmed (not a count we can confirm)", () => {
  const map = new Map([["panthella-160-v3-beige", -1]]);
  assert.deepEqual(decideStock(map, "panthella-160-v3-beige", units), {
    kind: "unconfirmed",
  });
});

test("non-integer count -> unconfirmed", () => {
  const map = new Map([["panthella-160-v3-beige", 1.5]]);
  assert.deepEqual(decideStock(map, "panthella-160-v3-beige", units), {
    kind: "unconfirmed",
  });
});

test("non-numeric count -> unconfirmed", () => {
  const map = new Map([["panthella-160-v3-beige", "2"]]);
  assert.deepEqual(decideStock(map, "panthella-160-v3-beige", units), {
    kind: "unconfirmed",
  });
});

test("missing drop size -> unconfirmed (no drop context, no badge)", () => {
  const map = new Map([["panthella-160-v3-beige", 2]]);
  assert.deepEqual(decideStock(map, "panthella-160-v3-beige", 0), {
    kind: "unconfirmed",
  });
  assert.deepEqual(decideStock(map, "panthella-160-v3-beige", 1.5), {
    kind: "unconfirmed",
  });
});

test("unconfirmed state carries no number", () => {
  const state = decideStock(null, "panthella-160-v3-beige", units);
  assert.equal("n" in state, false);
  assert.equal(state.kind, "unconfirmed");
  assert.equal(Object.isFrozen(UNCONFIRMED), true);
});

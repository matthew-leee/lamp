/**
 * Rust-exact text predicates (D2b review finding, cross-tier parity).
 *
 * WHY THIS EXISTS: the D2a admin API validates free text with Rust's
 * `str::trim()` — which trims by the Unicode `White_Space` property (no
 * U+FEFF, no BOM handling). JavaScript's `String.trim()` trims `White_Space`
 * PLUS U+FEFF (BOM), so a value the API considers NON-BLANK (e.g. a brand
 * name that is only "\uFEFF") can fail a `v.trim() !== ""` check on the web
 * side — a legal admin write would then throw the whole storefront
 * catalogue parse. The web parsers must judge blankness EXACTLY as the
 * writer does: a string is blank iff EVERY code point has the
 * `White_Space` property.
 *
 * Pure, dependency-free; the exact code-point set is pinned by tests
 * (test/catalog-client.test.mjs).
 */

/** The Unicode `White_Space` property code points (what Rust trims). */
const RUST_WHITESPACE = new Set<number>([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008,
  0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

/**
 * Blank by RUST's rule: every code point is `White_Space` (the set above).
 * Deliberately NOT U+FEFF — Rust does not trim it (review counterexample:
 * "\uFEFF" is a legal non-blank brand value), and JS `trim()` would
 * disagree.
 */
export function isRustBlank(value: string): boolean {
  for (const char of value) {
    if (!RUST_WHITESPACE.has(char.codePointAt(0) ?? -1)) return false;
  }
  return true;
}
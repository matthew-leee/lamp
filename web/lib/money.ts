/**
 * Integer-cents money formatting (ENV-01: currency comes from configuration).
 *
 * Money is stored and passed as integer minor units end to end; division and
 * rounding happen here for display only. The currency code is resolved site
 * configuration (env default, settings override; see lib/config.ts) and is
 * passed by callers — no hardcoded symbol, no hardcoded currency: swapping the
 * configured currency is the white-label test for prices.
 *
 * Rendering uses Intl.NumberFormat with the "en" locale for deterministic
 * comma grouping ("1,615") and minor digits shown only when non-zero:
 * "HK$1,615" / "HK$1,234.56" for HKD, and the equivalent for any other
 * ISO 4217 code the site is configured to sell in.
 */

/** ISO 4217: exactly three uppercase letters. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Format integer minor units as a display price in `currency`.
 *
 * Data-model constraint (documented, enforced nowhere else): the catalogue
 * stores minor units at 100 per major ("cents"); the configured currency
 * must therefore be a 2-minor-digit ISO 4217 code (HKD, USD, ...). Currencies
 * with other exponents (JPY, KWD) would rescale prices and are not
 * supported by this formatter or the seed/schema; rejecting them at the
 * config layer is the D2 admin console's job, this formatter validates only
 * the code's shape.
 *
 * @throws RangeError when `cents` is negative or not a safe integer, or when
 *   `currency` is not an ISO 4217-shaped code (the formatter must never
 *   render a plausible-looking price in a currency it was not given).
 */
export function formatMoney(cents: number, currency: string): string {
  if (typeof cents !== "number" || !Number.isSafeInteger(cents)) {
    throw new RangeError(
      `formatMoney: cents must be a safe integer, received ${String(cents)}`,
    );
  }
  if (cents < 0) {
    throw new RangeError(
      `formatMoney: cents must not be negative, received ${String(cents)}`,
    );
  }
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new RangeError(
      `formatMoney: currency must be an ISO 4217 code (e.g. HKD), received ${currency}`,
    );
  }

  // Whole amounts render without minor digits (161500 -> "HK$1,615");
  // non-zero minor units render with two (161555 -> "HK$1,615.55").
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

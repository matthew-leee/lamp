/**
 * Integer-cents money helpers.
 *
 * Money is stored and passed as integer HKD cents end to end (Vision.md
 * non-negotiable: money is never a float). Division happens here for display
 * only, on integers, so no value is ever rounded through binary floating
 * point before formatting.
 */

/**
 * Format integer HKD cents as a display price: "HK$1,615" for whole dollars
 * (all HAVN prices are whole dollars), "HK$1,234.56" when cents are non-zero.
 *
 * @throws RangeError when `cents` is negative or not an integer.
 */
export function formatHKD(cents: number): string {
  if (typeof cents !== "number" || !Number.isInteger(cents)) {
    throw new RangeError(
      `formatHKD: cents must be an integer, received ${String(cents)}`,
    );
  }
  if (cents < 0) {
    throw new RangeError(
      `formatHKD: cents must not be negative, received ${cents}`,
    );
  }

  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;

  // Group dollars in thousands: 1615 -> "1,615".
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return remainder === 0
    ? `HK$${grouped}`
    : `HK$${grouped}.${String(remainder).padStart(2, "0")}`;
}

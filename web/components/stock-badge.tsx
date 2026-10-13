"use client";
/**
 * Stock badge (Vision.md TRUST-02, commitment 5b).
 *
 * A client component: SSR HTML never contains a stock number (review finding
 * 1), so the badge renders the number-free placeholder until live availability
 * is confirmed in the browser via components/availability-context.tsx and
 * /api/availability. It then renders the lib/stock.ts decideStock() decision
 * as a bilingual pair:
 *
 *   "尚餘 N 件" / "N left"           confirmed availability > 0
 *   "售罄" / "Sold out"             confirmed availability 0
 *   "存貨確認中" / "Confirming availability"   loading, unconfirmed, or slug missing
 *
 * The unconfirmed state renders no number whatsoever: the badge never
 * displays a stock count it cannot confirm. The glow dot is ornament only
 * (globals.css: glow on bone is never text).
 */

import { useAvailability } from "./availability-context";
import { altLocale, htmlLang, type Locale } from "@/lib/i18n";
import { decideStock } from "@/lib/stock";
import {
  pick,
  stockLeftPair,
  stockSoldOut,
  stockUnconfirmed,
  type Bilingual,
} from "@/lib/ui-copy";

interface StockBadgeProps {
  slug: string;
  /** Units of this SKU in the numbered drop (catalog `units`). */
  unitsInDrop: number;
  lang: Locale;
}

export default function StockBadge({
  slug,
  unitsInDrop,
  lang,
}: StockBadgeProps) {
  const availability = useAvailability();
  // `loading` and `unconfirmed` both mean "nothing confirmed", so they pass a
  // null map to decideStock, which maps it to the number-free unconfirmed
  // state. Only a confirmed live map can produce a number or a sold-out claim.
  const state = decideStock(
    availability.state === "live" ? availability.map : null,
    slug,
    unitsInDrop,
  );
  const alt = altLocale(lang);

  const pair: Bilingual =
    state.kind === "left"
      ? stockLeftPair(state.n)
      : state.kind === "soldout"
        ? stockSoldOut
        : stockUnconfirmed;

  return (
    <p className="flex items-baseline gap-2 text-sm text-charcoal">
      <span aria-hidden="true" className="size-2 shrink-0 bg-glow" />
      <span lang={htmlLang[lang]}>{pick(pair, lang)}</span>
      <span aria-hidden="true" className="text-linen">
        /
      </span>
      <span lang={htmlLang[alt]}>{pick(pair, alt)}</span>
    </p>
  );
}

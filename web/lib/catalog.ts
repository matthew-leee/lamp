/**
 * Static catalogue for the HAVN opening drop (Vision.md DROP-01, DATA-01).
 *
 * This module is the catalogue content layer only: the 8 SKUs of the numbered
 * 16-piece Louis Poulsen opening drop. Postgres stays authoritative for live
 * availability (DATA-01); sellable stock is never hardcoded here and comes
 * from the API via lib/availability.ts. `units` and `dropNumbers` describe the
 * drop as bought (16 pieces in transit), not current sellable stock.
 *
 * Money is integer HKD cents end to end; format for display with
 * lib/money.ts (formatHKD).
 *
 * Copy rules (TRUST-02, open item 4): reference prices are labelled with a
 * source and a checked date, and electrical copy states verified facts only.
 * It never promises plug replacement or adapters: EU plug handling is an
 * open founder decision and the final HK plug configuration is confirmed at
 * inspection. No em-dashes in user-facing copy.
 */

/** Bilingual display pair (I18N-01: both languages first-class). */
export interface LocalizedText {
  en: string;
  zhHK: string;
}

/**
 * Labelled reference price (TRUST-02): a real market comparison with its
 * source and the date it was checked. `null` means no verified reference
 * exists; the UI must say verification is pending instead of inventing one.
 */
export interface ReferencePrice {
  minCents: number;
  maxCents: number;
  source: string;
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) the source was last checked. */
  checkedAt: string;
}

/** One SKU of the opening drop. */
export interface CatalogProduct {
  /** Stable product slug; matches the API slug charset (lowercase alnum + hyphens). */
  slug: string;
  brand: string;
  model: string;
  /** Chinese display name; Latin model names kept per brand convention. */
  modelAlt: string;
  colourway: LocalizedText;
  /** Units of this SKU in the 16-piece drop. */
  units: number;
  priceCents: number;
  /** Piece numbers (rendered 01-16) of this SKU's units, in table order. */
  dropNumbers: number[];
  referencePrice: ReferencePrice | null;
  heritage: LocalizedText;
  electrical: LocalizedText;
  /** Styled placeholder art hint until own stock photography lands (open item 6). */
  placeholder: { hue: number };
}

/* Shared copy blocks. Heritage and electrical facts are true per model family,
   so one reviewed bilingual block per family avoids drifting duplicates. */

const panthellaHeritage: LocalizedText = {
  en: "The Panthella was designed by Verner Panton in 1971. Its trumpet-shaped base and domed shade work together to reflect light softly, leaving the silhouette itself as the only ornament. The Panthella 160 Portable carries that profile into a compact rechargeable table lamp.",
  zhHK:
    "Panthella 由 Verner Panton 於 1971 年設計。喇叭形的彎曲底座與半球形燈罩互相呼應，柔和地反射光線，整道輪廓本身就是唯一的裝飾。Panthella 160 便攜版把這道經典線條濃縮成一部小巧的充電式檯燈。",
};

const phHeritage: LocalizedText = {
  en: "The PH lamp system was designed by Poul Henningsen, whose three-shade design first appeared at the 1925 Paris Exhibition. The shades shape the light as it leaves the source, sending a soft, glare-free glow downwards and outwards. PH table lamps bring that lighting principle into a compact format for the home.",
  zhHK:
    "PH 燈飾系統由 Poul Henningsen 設計，其三層燈罩結構於 1925 年巴黎國際裝飾藝術博覽會首次亮相。燈罩塑造光線離開光源的路徑，把柔和無眩光的光線送往下方與四周。PH 檯燈把這套照明原理帶入小巧的家居比例。",
};

const panthellaElectrical: LocalizedText = {
  en: "The Panthella 160 Portable runs on a rechargeable battery, so no mains plug is in use in daily operation. Hong Kong mains supply is 220-240V at 50Hz with Type G sockets. The charging accessories supplied with each lamp will be confirmed at inspection.",
  zhHK:
    "Panthella 160 便攜版內置可充電電池，日常使用時無需接駁市電插頭。香港市電為 220-240V、50Hz，插座規格為 Type G（英式三腳）。每部燈隨附的充電配件將於實物檢查時確認。",
};

const phElectrical: LocalizedText = {
  en: "The corded PH table lamps are supplied with EU plugs. Hong Kong mains supply is 220-240V at 50Hz with Type G sockets. The final plug configuration for Hong Kong will be confirmed at inspection.",
  zhHK:
    "有線 PH 檯燈出廠時附歐規插頭。香港市電為 220-240V、50Hz，插座規格為 Type G（英式三腳）。香港使用的最終插頭配置將於實物檢查時確認。",
};

/* Labelled reference prices (TRUST-02), checked 2026-10-12 at MyConcept
   Hong Kong. The PH 1/1 Piano Table has no verified reference, so its
   referencePrice stays null and the UI shows verification pending. */

const panthellaReferencePrice: ReferencePrice = {
  minCents: 190000,
  maxCents: 280000,
  source: "MyConcept Hong Kong",
  sourceUrl:
    "https://www.myconcept.com.hk/products/panthella-160-portable-table-lamp",
  checkedAt: "2026-10-12",
};

const ph21ReferencePrice: ReferencePrice = {
  minCents: 840000,
  maxCents: 940000,
  source: "MyConcept Hong Kong",
  sourceUrl: "https://www.myconcept.com.hk/products/louis-poulsen-ph-21-table",
  checkedAt: "2026-10-12",
};

const ph32ReferencePrice: ReferencePrice = {
  minCents: 1220000,
  maxCents: 1330000,
  source: "MyConcept Hong Kong",
  sourceUrl: "https://www.myconcept.com.hk/products/ph-3-2-table",
  checkedAt: "2026-10-12",
};

/**
 * The 8 SKUs of the opening drop, in drop order. `dropNumbers` number the 16
 * pieces sequentially across the table (01-16).
 */
export const CATALOG: readonly CatalogProduct[] = [
  {
    slug: "panthella-160-v3-beige",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    modelAlt: "Panthella 160 V3 便攜檯燈",
    colourway: { en: "Beige", zhHK: "米色" },
    units: 2,
    priceCents: 161500,
    dropNumbers: [1, 2],
    referencePrice: panthellaReferencePrice,
    heritage: panthellaHeritage,
    electrical: panthellaElectrical,
    placeholder: { hue: 35 },
  },
  {
    slug: "panthella-160-v3-white-opal",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    modelAlt: "Panthella 160 V3 便攜檯燈",
    colourway: { en: "White Opal", zhHK: "白蛋白石色" },
    units: 5,
    priceCents: 161500,
    dropNumbers: [3, 4, 5, 6, 7],
    referencePrice: panthellaReferencePrice,
    heritage: panthellaHeritage,
    electrical: panthellaElectrical,
    placeholder: { hue: 40 },
  },
  {
    slug: "panthella-160-v3-opal-beige-chrome",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    modelAlt: "Panthella 160 V3 便攜檯燈",
    colourway: { en: "Opal Beige/Chrome", zhHK: "蛋白石米色配鍍鉻" },
    units: 2,
    priceCents: 238000,
    dropNumbers: [8, 9],
    referencePrice: panthellaReferencePrice,
    heritage: panthellaHeritage,
    electrical: panthellaElectrical,
    placeholder: { hue: 30 },
  },
  {
    slug: "panthella-160-v3-opal-pale-blue",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    modelAlt: "Panthella 160 V3 便攜檯燈",
    colourway: { en: "Opal Pale Blue", zhHK: "蛋白石淡藍色" },
    units: 1,
    priceCents: 161500,
    dropNumbers: [10],
    referencePrice: panthellaReferencePrice,
    heritage: panthellaHeritage,
    electrical: panthellaElectrical,
    placeholder: { hue: 205 },
  },
  {
    slug: "panthella-160-v3-opal-pale-rose",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    modelAlt: "Panthella 160 V3 便攜檯燈",
    colourway: { en: "Opal Pale Rose", zhHK: "蛋白石淡玫瑰色" },
    units: 1,
    priceCents: 161500,
    dropNumbers: [11],
    referencePrice: panthellaReferencePrice,
    heritage: panthellaHeritage,
    electrical: panthellaElectrical,
    placeholder: { hue: 350 },
  },
  {
    slug: "ph-2-1-table-chrome",
    brand: "Louis Poulsen",
    model: "PH 2/1 Table",
    modelAlt: "PH 2/1 檯燈",
    colourway: { en: "Chrome", zhHK: "鍍鉻" },
    units: 3,
    priceCents: 714000,
    dropNumbers: [12, 13, 14],
    referencePrice: ph21ReferencePrice,
    heritage: phHeritage,
    electrical: phElectrical,
    placeholder: { hue: 210 },
  },
  {
    slug: "ph-3-2-table-chrome",
    brand: "Louis Poulsen",
    model: "PH 3/2 Table",
    modelAlt: "PH 3/2 檯燈",
    colourway: { en: "Chrome", zhHK: "鍍鉻" },
    units: 1,
    priceCents: 1037000,
    dropNumbers: [15],
    referencePrice: ph32ReferencePrice,
    heritage: phHeritage,
    electrical: phElectrical,
    placeholder: { hue: 210 },
  },
  {
    slug: "ph-1-1-piano-table-limited",
    brand: "Louis Poulsen",
    model: "PH 1/1 Piano Table",
    modelAlt: "PH 1/1 Piano 檯燈",
    colourway: { en: "Limited", zhHK: "限量版" },
    units: 1,
    priceCents: 1079500,
    dropNumbers: [16],
    referencePrice: null,
    heritage: phHeritage,
    electrical: phElectrical,
    placeholder: { hue: 45 },
  },
];

/** The numbered opening drop as a whole (DROP-01). */
export const DROP = { totalPieces: 16 } as const;

/** Units in the drop; derived from the catalogue so it cannot drift from the SKUs. */
export const totalUnits: number = CATALOG.reduce(
  (sum, product) => sum + product.units,
  0,
);

/** Look up a SKU by slug, or `undefined` when the slug is not in the catalogue. */
export function getProduct(slug: string): CatalogProduct | undefined {
  return CATALOG.find((product) => product.slug === slug);
}

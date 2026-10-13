/*
  Seed mirror + independent approved-copy fixtures (D1).

  Two roles, deliberately duplicated from the SEED (api/migrations/
  0003_seed_opening_drop.sql), never imported from production modules:
  1. The behavioural suites build expectations for the baked pages from the
     seed data: if the seed changes, these fixtures are an INDEPENDENT
     second copy that must be updated deliberately, so a quiet seed edit
     that changes rendered pages fails the tests.
  2. The trust copy literals keep the T3 property that expectations are not
     derived from the production copy path (review finding 3): site copy now
     lives in the database; this fixture is the reviewable pin of what the
     rendered copy must be for the test brand.

  The test brand is HVILE (NAME-01: the brand is env-supplied; the
  behavioural build runs with NEXT_PUBLIC_BRAND_NAME=HVILE and no WhatsApp
  number, so the "render nothing" WhatsApp branch is guaranteed).
*/

/** The brand the behavioural build bakes (NEXT_PUBLIC_BRAND_NAME=HVILE). */
export const BRAND = "HVILE";

/** The currency the behavioural build bakes (default HKD). */
export const CURRENCY = "HKD";

/** Placeholder replacement, intentionally NOT lib/config.ts's function:
    expectations must not be derived from the code under test. Supported
    vars: {brand}, {subject}, {pieces} (the catalogue-derived drop size). */
export function render(template, vars = {}) {
  let out = template.split("{brand}").join(vars.brand ?? BRAND);
  if (vars.subject !== undefined) {
    out = out.split("{subject}").join(vars.subject);
  }
  if (vars.pieces !== undefined) {
    out = out.split("{pieces}").join(vars.pieces);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Site content templates (seed verbatim)                              */
/* ------------------------------------------------------------------ */

export const SITE_CONTENT = {
  "hero.eyebrow": { en: "The opening drop", "zh-HK": "首發登場" },
  "hero.lead": {
    en: "Curated designer homeware. The whole opening drop is physically in Hong Kong.",
    "zh-HK": "精選設計家居。整批首發燈飾俱在香港。",
  },
  "hero.leadPaired": {
    en: "{brand}, curated designer homeware. The whole opening drop is physically in Hong Kong.",
    "zh-HK": "{brand} 精選設計家居。整批首發燈飾俱在香港。",
  },
  "drop.framing": {
    en: "The opening drop: {pieces} numbered pieces of Louis Poulsen lighting.",
    "zh-HK": "首發登場：{pieces} 件編號 Louis Poulsen 燈飾。",
  },
  "drop.piecesHeading": {
    en: "The pieces in the drop",
    "zh-HK": "首發燈飾系列",
  },
  "trust.disclosure": {
    en: "{brand} is an independent seller and is not an authorised Louis Poulsen dealer. All trademarks belong to their owners.",
    "zh-HK":
      "{brand} 為獨立賣家，並非 Louis Poulsen 授權經銷商。所有商標均屬其擁有者。",
  },
  "warranty.pending": {
    en: "{brand} gives its own warranty on every piece it sells. The exact terms are still being finalised and will be published here before the first sale, in {brand} wording. The Louis Poulsen manufacturer warranty is never quoted as the {brand} warranty.",
    "zh-HK":
      "{brand} 為所售出的每件燈飾提供自家保養。具體條款仍在釐定中，將以 {brand} 自己的用詞於首宗銷售前在此公佈。Louis Poulsen 的原廠保養絕不會被引用為 {brand} 的保養條款。",
  },
  "reference.pending": {
    en: "Reference price: verification pending. A comparison price is published here only once a real source has been checked and the check date recorded.",
    "zh-HK":
      "參考價：核實中。只有在核實真實來源並記錄查核日期後，比較價才會在此公佈。",
  },
  "enquiry.intro": {
    en: "Questions about a piece? Ask on WhatsApp.",
    "zh-HK": "對某件燈飾有疑問？WhatsApp 查詢。",
  },
  "enquiry.messageTemplate": {
    en: "Hi {brand}, I would like to ask about {subject}.",
    "zh-HK": "你好 {brand}，我想查詢 {subject}。",
  },
  "enquiry.dropSubject": {
    en: "the opening drop of Louis Poulsen lighting",
    "zh-HK": "Louis Poulsen 首發燈飾系列",
  },
  "meta.home.title": {
    en: "{brand} | Curated designer homeware, the opening drop",
    "zh-HK": "{brand} | 精選設計家居 · 首發登場",
  },
  "meta.home.description": {
    en: "{brand}, curated designer homeware. The opening drop of designer lighting: {pieces} numbered pieces, the whole drop physically in Hong Kong.",
    "zh-HK":
      "{brand} 精選設計家居。設計燈飾首發登場，{pieces} 件編號作品，整批俱在香港。",
  },
  "meta.product.descriptionTemplate": {
    en: "{subject}. A numbered piece of the {brand} opening drop of Louis Poulsen lighting. {brand} is an independent seller.",
    "zh-HK":
      "{subject}，{brand} 首發登場的編號 Louis Poulsen 燈飾。{brand} 為獨立賣家。",
  },
  "notFound.title": {
    en: "{brand} | Page not found / 找不到頁面",
    "zh-HK": "{brand} | Page not found / 找不到頁面",
  },
  "notFound.description": {
    en: "Page not found. 找不到頁面。{brand}, curated designer homeware, Hong Kong.",
    "zh-HK": "Page not found. 找不到頁面。{brand}, curated designer homeware, Hong Kong.",
  },
  "notFound.body": {
    en: "This page does not exist. The two language editions of {brand} are linked below.",
    "zh-HK": "此頁面不存在。以下連結前往 {brand} 兩個語言版本。",
  },
  "footer.location": { en: "Hong Kong", "zh-HK": "香港" },
};

/** One site-content key rendered with the test brand (and, where a key
    names the drop size, the catalogue-derived total). */
export function siteContent(key, locale) {
  return render(SITE_CONTENT[key][locale], { pieces: String(TOTAL_PIECES) });
}

/* ------------------------------------------------------------------ */
/* Catalogue fixture (seed verbatim; mirrors the API's /api/catalogue) */
/* ------------------------------------------------------------------ */

const PANTHELLA_HERITAGE = {
  en: "The Panthella was designed by Verner Panton in 1971. Its trumpet-shaped base and domed shade work together to reflect light softly, leaving the silhouette itself as the only ornament. The Panthella 160 Portable carries that profile into a compact rechargeable table lamp.",
  "zh-HK":
    "Panthella 由 Verner Panton 於 1971 年設計。喇叭形的彎曲底座與半球形燈罩互相呼應，柔和地反射光線，整道輪廓本身就是唯一的裝飾。Panthella 160 便攜版把這道經典線條濃縮成一部小巧的充電式檯燈。",
};

const PH_HERITAGE = {
  en: "The PH lamp system was designed by Poul Henningsen, whose three-shade design first appeared at the 1925 Paris Exhibition. The shades shape the light as it leaves the source, sending a soft, glare-free glow downwards and outwards. PH table lamps bring that lighting principle into a compact format for the home.",
  "zh-HK":
    "PH 燈飾系統由 Poul Henningsen 設計，其三層燈罩結構於 1925 年巴黎國際裝飾藝術博覽會首次亮相。燈罩塑造光線離開光源的路徑，把柔和無眩光的光線送往下方與四周。PH 檯燈把這套照明原理帶入小巧的家居比例。",
};

const PANTHELLA_ELECTRICAL = {
  en: "The Panthella 160 Portable runs on a rechargeable battery, so no mains plug is in use in daily operation. Hong Kong mains supply is 220-240V at 50Hz with Type G sockets. The charging accessories supplied with each lamp will be confirmed at inspection.",
  "zh-HK":
    "Panthella 160 便攜版內置可充電電池，日常使用時無需接駁市電插頭。香港市電為 220-240V、50Hz，插座規格為 Type G（英式三腳）。每部燈隨附的充電配件將於實物檢查時確認。",
};

const PH_ELECTRICAL = {
  en: "The corded PH table lamps are supplied with EU plugs. Hong Kong mains supply is 220-240V at 50Hz with Type G sockets. The final plug configuration for Hong Kong will be confirmed at inspection.",
  "zh-HK":
    "有線 PH 檯燈出廠時附歐規插頭。香港市電為 220-240V、50Hz，插座規格為 Type G（英式三腳）。香港使用的最終插頭配置將於實物檢查時確認。",
};

const PANTHELLA_REFERENCE = {
  minPriceCents: 190000,
  maxPriceCents: 280000,
  sourceName: "MyConcept Hong Kong",
  sourceUrl:
    "https://www.myconcept.com.hk/products/panthella-160-portable-table-lamp",
  checkedOn: "2026-10-12",
};

const PH21_REFERENCE = {
  minPriceCents: 840000,
  maxPriceCents: 940000,
  sourceName: "MyConcept Hong Kong",
  sourceUrl: "https://www.myconcept.com.hk/products/louis-poulsen-ph-21-table",
  checkedOn: "2026-10-12",
};

const PH32_REFERENCE = {
  minPriceCents: 1220000,
  maxPriceCents: 1330000,
  sourceName: "MyConcept Hong Kong",
  sourceUrl: "https://www.myconcept.com.hk/products/ph-3-2-table",
  checkedOn: "2026-10-12",
};

/** The seeded catalogue (mirrors /api/catalogue, camelCase like the client). */
export const CATALOGUE = [
  {
    slug: "panthella-160-v3-beige",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    priceCents: 161500,
    art: { variant: "dome", hue: 35 },
    content: {
      en: { colourway: "Beige" },
      "zh-HK": { modelAlt: "Panthella 160 V3 便攜檯燈", colourway: "米色" },
    },
    referencePrice: PANTHELLA_REFERENCE,
    pieces: [1, 2],
    unitsInDrop: 2,
    heritage: PANTHELLA_HERITAGE,
    electrical: PANTHELLA_ELECTRICAL,
  },
  {
    slug: "panthella-160-v3-white-opal",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    priceCents: 161500,
    art: { variant: "dome", hue: 40 },
    content: {
      en: { colourway: "White Opal" },
      "zh-HK": { modelAlt: "Panthella 160 V3 便攜檯燈", colourway: "白蛋白石色" },
    },
    referencePrice: PANTHELLA_REFERENCE,
    pieces: [3, 4, 5, 6, 7],
    unitsInDrop: 5,
    heritage: PANTHELLA_HERITAGE,
    electrical: PANTHELLA_ELECTRICAL,
  },
  {
    slug: "panthella-160-v3-opal-beige-chrome",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    priceCents: 238000,
    art: { variant: "dome", hue: 30 },
    content: {
      en: { colourway: "Opal Beige/Chrome" },
      "zh-HK": {
        modelAlt: "Panthella 160 V3 便攜檯燈",
        colourway: "蛋白石米色配鍍鉻",
      },
    },
    referencePrice: PANTHELLA_REFERENCE,
    pieces: [8, 9],
    unitsInDrop: 2,
    heritage: PANTHELLA_HERITAGE,
    electrical: PANTHELLA_ELECTRICAL,
  },
  {
    slug: "panthella-160-v3-opal-pale-blue",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    priceCents: 161500,
    art: { variant: "dome", hue: 205 },
    content: {
      en: { colourway: "Opal Pale Blue" },
      "zh-HK": { modelAlt: "Panthella 160 V3 便攜檯燈", colourway: "蛋白石淡藍色" },
    },
    referencePrice: PANTHELLA_REFERENCE,
    pieces: [10],
    unitsInDrop: 1,
    heritage: PANTHELLA_HERITAGE,
    electrical: PANTHELLA_ELECTRICAL,
  },
  {
    slug: "panthella-160-v3-opal-pale-rose",
    brand: "Louis Poulsen",
    model: "Panthella 160 V3 Portable",
    priceCents: 161500,
    art: { variant: "dome", hue: 350 },
    content: {
      en: { colourway: "Opal Pale Rose" },
      "zh-HK": { modelAlt: "Panthella 160 V3 便攜檯燈", colourway: "蛋白石淡玫瑰色" },
    },
    referencePrice: PANTHELLA_REFERENCE,
    pieces: [11],
    unitsInDrop: 1,
    heritage: PANTHELLA_HERITAGE,
    electrical: PANTHELLA_ELECTRICAL,
  },
  {
    slug: "ph-2-1-table-chrome",
    brand: "Louis Poulsen",
    model: "PH 2/1 Table",
    priceCents: 714000,
    art: { variant: "shades", hue: 210 },
    content: {
      en: { colourway: "Chrome" },
      "zh-HK": { modelAlt: "PH 2/1 檯燈", colourway: "鍍鉻" },
    },
    referencePrice: PH21_REFERENCE,
    pieces: [12, 13, 14],
    unitsInDrop: 3,
    heritage: PH_HERITAGE,
    electrical: PH_ELECTRICAL,
  },
  {
    slug: "ph-3-2-table-chrome",
    brand: "Louis Poulsen",
    model: "PH 3/2 Table",
    priceCents: 1037000,
    art: { variant: "shades", hue: 210 },
    content: {
      en: { colourway: "Chrome" },
      "zh-HK": { modelAlt: "PH 3/2 檯燈", colourway: "鍍鉻" },
    },
    referencePrice: PH32_REFERENCE,
    pieces: [15],
    unitsInDrop: 1,
    heritage: PH_HERITAGE,
    electrical: PH_ELECTRICAL,
  },
  {
    slug: "ph-1-1-piano-table-limited",
    brand: "Louis Poulsen",
    model: "PH 1/1 Piano Table",
    priceCents: 1079500,
    art: { variant: "shades", hue: 45 },
    content: {
      en: { colourway: "Limited" },
      "zh-HK": { modelAlt: "PH 1/1 Piano 檯燈", colourway: "限量版" },
    },
    referencePrice: null,
    pieces: [16],
    unitsInDrop: 1,
    heritage: PH_HERITAGE,
    electrical: PH_ELECTRICAL,
  },
];

/** The drop total as the seeded pieces make it (a COUNT, not a constant). */
export const TOTAL_PIECES = CATALOGUE.reduce(
  (sum, product) => sum + product.pieces.length,
  0,
);

/** Display name of a fixture SKU in one locale (mirrors productDisplay:
    ASCII parens for the first locale, full-width for the second/CJK). */
export function fixtureProductDisplay(product, locale) {
  const content = product.content[locale] ?? {};
  const model = content.modelAlt ?? product.model;
  const colourway = content.colourway ?? "";
  if (colourway === "") return model;
  return locale === "zh-HK"
    ? `${model}（${colourway}）`
    : `${model} (${colourway})`;
}

/** Drop numbering in one locale (mirrors dropNumbering: contiguous runs
    render as ranges, non-contiguous sets as an explicit comma list). */
export function fixtureDropNumbering(pieces, totalPieces, locale) {
  const sorted = [...pieces].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const pad2 = (n) => String(n).padStart(2, "0");
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  const range = contiguous
    ? first === last
      ? pad2(first)
      : `${pad2(first)}-${pad2(last)}`
    : sorted.map(pad2).join(", ");
  if (locale === "zh-HK") {
    return `第 ${range} 件，共 ${totalPieces} 件`;
  }
  return `${first === last ? "Piece" : "Pieces"} ${range} of ${totalPieces}`;
}

/** Reference range in one locale (mirrors referenceRange). */
export function fixtureReferenceRange(reference, currency, locale) {
  const min = fixtureMoney(reference.minPriceCents, currency);
  const max = fixtureMoney(reference.maxPriceCents, currency);
  if (min === max) return min;
  return locale === "zh-HK" ? `${min} 至 ${max}` : `${min} to ${max}`;
}

/** Reference checked-date note in one locale (mirrors referenceChecked). */
export function fixtureReferenceChecked(reference, locale) {
  return locale === "zh-HK"
    ? `查核日期 ${reference.checkedOn}`
    : `checked ${reference.checkedOn}`;
}

/** HKD money rendering for the fixture currency (mirrors formatMoney for HKD). */
export function fixtureMoney(cents, currency = CURRENCY) {
  if (currency !== "HKD") {
    throw new Error(`fixtureMoney: unsupported fixture currency ${currency}`);
  }
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return remainder === 0
    ? `HK$${grouped}`
    : `HK$${grouped}.${String(remainder).padStart(2, "0")}`;
}

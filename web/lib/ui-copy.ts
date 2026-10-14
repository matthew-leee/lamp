/**
 * Chrome labels and pure copy formatters for the storefront.
 *
 * SPLIT between code and data (DATA-02 + the README "Configuration and data
 * principles"):
 * - **Chrome stays here**: navigation labels, availability states, section
 *   headings, button labels. They name UI parts, carry no company data, and
 *   belong to the interface, not the company.
 * - **Company copy lives in the database**: identity, positioning, policy and
 *   meta copy (hero, disclosure, warranty, reference-price pending note,
 *   enquiry templates, page metadata, 404 copy) is seeded into `site_content`
 *   and fetched at build time via lib/catalog-client.ts. Nothing brand- or
 *   data-bearing is hardcoded here.
 *
 * Formatters here are pure functions over fetched data (CatalogueProduct,
 * ReferencePrice, SiteContent) so they stay unit-testable without a network.
 *
 * Copy rules (I18N-01, founder decision 2026-10-14): SINGLE-LOCALE DISPLAY.
 * Every storefront passage renders ONLY the text of the locale the visitor
 * chose; the alt locale never renders (the sole exception is the language
 * switcher control, whose links may name each locale in its own script).
 * The old paired-equal-weight display (every passage in both languages) is
 * RETIRED. Copy DATA still exists per locale (site_content and product copy
 * are locale-keyed) and each rendered passage keeps its lang attribute
 * (WCAG 3.1.2 Language of Parts). pick() is THE single-locale reader.
 * No em-dashes; no apostrophes in user-facing copy. Prices format only
 * through lib/money.ts with the configured currency.
 */

import { renderTemplate } from "./config.ts";
import {
  contentValue,
  type CatalogueProduct,
  type ReferencePrice,
  type SiteContent,
} from "./catalog-client.ts";
import { formatMoney } from "./money.ts";
import { locales, type Locale } from "./i18n.ts";

/**
 * Chrome label copy carried per locale (one entry per configured locale).
 * Rendering picks ONE locale's text (see pick): the map is data, not a
 * display pair.
 */
export type Bilingual = Record<Locale, string>;

/**
 * Read the chosen locale's text of a label map, with graceful fallback: a
 * locale without its own chrome label falls back to the first defined entry
 * rather than rendering blank. The default pair (en, zh-HK) is fully
 * covered; a company running a different language pair adds their labels
 * alongside (documented white-label step, like restyling the CSS tokens).
 * This is THE single-locale reader (founder 2026-10-14: one language per
 * page); nothing renders a second language next to it.
 */
export function pick(text: Bilingual, locale: Locale): string {
  const value = text[locale];
  if (typeof value === "string") return value;
  const fallback = text["en"] ?? Object.values(text)[0];
  if (fallback === undefined) {
    throw new RangeError(`pick: empty bilingual pair for locale ${locale}`);
  }
  return fallback;
}

/* ------------------------------------------------------------------ */
/* Navigation and chrome labels                                        */
/* ------------------------------------------------------------------ */

export const navMainLabel: Bilingual = {
  en: "Main navigation",
  "zh-HK": "主要導覽",
};

export const navHome: Bilingual = {
  en: "Home",
  "zh-HK": "首頁",
};

export const languageLabel: Bilingual = {
  en: "Language",
  "zh-HK": "語言",
};

export const backToDrop: Bilingual = {
  en: "Back to the opening drop",
  "zh-HK": "返回首發登場",
};

/* ------------------------------------------------------------------ */
/* Trust block labels (the passages themselves are site content)        */
/* ------------------------------------------------------------------ */

export const priceLabel: Bilingual = {
  en: "Price",
  "zh-HK": "售價",
};

export const disclosureLabel: Bilingual = {
  en: "Independent seller",
  "zh-HK": "獨立賣家",
};

export const trustStripLabel: Bilingual = {
  en: "Independent seller",
  "zh-HK": "獨立賣家",
};

export const warrantyLabel: Bilingual = {
  en: "Warranty",
  "zh-HK": "保養",
};

export const referenceLabel: Bilingual = {
  en: "Reference price, for comparison",
  "zh-HK": "參考價，作比較",
};

export const referenceSourceLabel: Bilingual = {
  en: "Source",
  "zh-HK": "來源",
};

export const electricalLabel: Bilingual = {
  en: "Electrical",
  "zh-HK": "電器規格",
};

export const heritageLabel: Bilingual = {
  en: "Heritage",
  "zh-HK": "設計傳承",
};

/* ------------------------------------------------------------------ */
/* Buttons and interactions                                            */
/* ------------------------------------------------------------------ */

export const enquiryButtonLabel: Bilingual = {
  en: "WhatsApp enquiry",
  "zh-HK": "WhatsApp 查詢",
};

export const lightsToggleLabel: Bilingual = {
  en: "Lights on / lights off",
  "zh-HK": "開燈 / 關燈",
};

export const artPlaceholderNote: Bilingual = {
  en: "Placeholder artwork",
  "zh-HK": "暫代圖片",
};

/* ------------------------------------------------------------------ */
/* Stock badge labels (never a number in the unconfirmed state)        */
/* ------------------------------------------------------------------ */

/**
 * The confirmed-count label map for `n` units left (one label per locale;
 * the badge renders the chosen locale's via pick).
 */
export function stockLeft(n: number): Bilingual {
  return {
    en: `${n} left`,
    "zh-HK": `尚餘 ${n} 件`,
  };
}

export const stockSoldOut: Bilingual = {
  en: "Sold out",
  "zh-HK": "售罄",
};

export const stockUnconfirmed: Bilingual = {
  en: "Confirming availability",
  "zh-HK": "存貨確認中",
};

/* ------------------------------------------------------------------ */
/* Formatters over fetched data                                        */
/* ------------------------------------------------------------------ */

/**
 * Display name of one SKU in one locale: model + colourway from content.
 * The first (Latin-script) locale joins with ASCII parentheses, the second
 * (CJK) locale with full-width parentheses, matching each script's
 * convention (the seeded zh-HK copy expects full-width).
 */
export function productDisplay(
  product: CatalogueProduct,
  locale: string,
): string {
  const content = product.content[locale] ?? {};
  const model = content.modelAlt ?? product.model;
  const colourway = content.colourway ?? "";
  if (colourway === "") return model;
  return locale === locales[1]
    ? `${model}（${colourway}）`
    : `${model} (${colourway})`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Drop numbering (DROP-01) in one locale. Contiguous piece runs render as
 * ranges ("Pieces 03-07 of 16"); a non-contiguous set renders as an explicit
 * comma list ("Pieces 03, 07 of 16") — a span must never claim pieces the
 * SKU does not own.
 */
export function dropNumbering(
  dropNumbers: readonly number[],
  totalPieces: number,
  locale: string,
): string {
  const sorted = [...dropNumbers].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    throw new RangeError("dropNumbering: dropNumbers must not be empty");
  }
  if (totalPieces < 1 || !Number.isInteger(totalPieces)) {
    throw new RangeError("dropNumbering: totalPieces must be a positive integer");
  }

  const contiguous = sorted.every(
    (n, i) => i === 0 || n === sorted[i - 1]! + 1,
  );
  const range = contiguous
    ? first === last
      ? pad2(first)
      : `${pad2(first)}-${pad2(last)}`
    : sorted.map(pad2).join(", ");
  const pieceWord = first === last ? "Piece" : "Pieces";
  if (locale === locales[1]) {
    return `第 ${range} 件，共 ${totalPieces} 件`;
  }
  return `${pieceWord} ${range} of ${totalPieces}`;
}

/**
 * Labelled reference price range in `currency` for one locale
 * ("HK$1,900 to HK$2,800" / "HK$1,900 至 HK$2,800").
 */
export function referenceRange(
  ref: ReferencePrice,
  currency: string,
  locale: string,
): string {
  const min = formatMoney(ref.minPriceCents, currency);
  const max = formatMoney(ref.maxPriceCents, currency);
  if (min === max) return min;
  return locale === locales[1] ? `${min} 至 ${max}` : `${min} to ${max}`;
}

/** The checked date of a labelled reference price, one locale. */
export function referenceChecked(ref: ReferencePrice, locale: string): string {
  return locale === locales[1]
    ? `查核日期 ${ref.checkedOn}`
    : `checked ${ref.checkedOn}`;
}

/** Accessible name for a placeholder artwork of `subject` in one locale.
    Word order follows the chosen locale (Latin first, CJK second);
    placeholder art is development-phase chrome replaced by photography
    before launch. */
export function artLabel(subject: string, locale: string): string {
  if (locale === locales[1]) {
    return `${subject} 的${artPlaceholderNote[locales[1]]}`;
  }
  return `${artPlaceholderNote[locales[0]]} for ${subject}`;
}

/* ------------------------------------------------------------------ */
/* Site-content compositions (templates rendered with the resolved     */
/* brand; templates and copy come from the `site_content` table)       */
/* ------------------------------------------------------------------ */

/** Neutral product meta description (never an availability claim). */
export function productMetaDescription(
  content: SiteContent,
  brand: string,
  subject: string,
  locale: string,
): string {
  const template = contentValue(
    content,
    "meta.product.descriptionTemplate",
    locale,
  );
  return renderTemplate(template, { brand, subject });
}

/**
 * Prefilled WhatsApp enquiry message in the CHOSEN locale only (the
 * enquiry.messageTemplate copy of that locale, rendered with the brand and
 * the subject). Single-locale like every other passage (founder 2026-10-14):
 * the message the visitor sends reads in the language they chose.
 */
export function buildEnquiryMessage(
  content: SiteContent,
  brand: string,
  subject: string,
  locale: string,
): string {
  return renderTemplate(
    contentValue(content, "enquiry.messageTemplate", locale),
    { brand, subject },
  );
}

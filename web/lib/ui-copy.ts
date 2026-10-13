/**
 * Shared bilingual UI copy for the HAVN storefront (Vision.md I18N-01).
 *
 * Every user-facing string that appears in more than one place lives here, so
 * pages and components never carry their own scattered duplicates. Copy rules
 * encoded in this file:
 *
 * - Traditional Chinese and English are first-class and equal weight: paired
 *   passages are typed `Bilingual = Record<Locale, string>` (both locales, one
 *   source of truth) and rendered in both languages on every page, each
 *   passage with its own lang attribute (WCAG 3.1.2 Language of Parts).
 * - Trust copy (TRUST-01, TRUST-02) states only verified facts in HAVN's own
 *   words. Warranty wording is a founder open item, so it renders honest
 *   pending copy and never invented terms. Reference prices carry a source
 *   and a checked date; when none is verified the UI says verification is
 *   pending instead of inventing one.
 * - Availability copy policy (commitment 5b + review finding 2): the stock
 *   badge's confirmed "N left" state is the ONLY per-SKU availability claim on
 *   the site. Nothing here states that a SKU is "in stock" unconditionally.
 *   The single drop-level location fact (the whole drop is physically in Hong
 *   Kong) lives in the homepage hero lead only, worded as a fact about the
 *   whole drop. Commitment 7: nothing here states a delivery duration,
 *   because none has been decided.
 * - No em-dashes (U+2014) in user-facing copy; hyphens and CJK punctuation
 *   instead. No apostrophes in user-facing copy either (SSR escapes them as
 *   entities, which makes strict copy assertions fragile).
 *
 * Prices are formatted only through lib/money.ts (formatHKD).
 */

import type { CatalogProduct, LocalizedText, ReferencePrice } from "./catalog";
// Explicit .ts extension so Node can import this module directly in unit
// tests (test/ui-copy.test.mjs) alongside Next (allowImportingTsExtensions).
import { formatHKD } from "./money.ts";
import type { Locale } from "./i18n";

/** A passage carried in both locales (equal weight everywhere). */
export type Bilingual = Record<Locale, string>;

/** A locale-parameterised label (stock counts, piece numbering). */
export type BilingualFormatter<Args extends readonly unknown[]> = Record<
  Locale,
  (...args: Args) => string
>;

/** Read one language of a bilingual pair. */
export function pick(text: Bilingual, locale: Locale): string {
  return text[locale];
}

/**
 * Read one language of a catalog `LocalizedText` pair (its keys are `en` /
 * `zhHK`, mirroring lib/catalog.ts).
 */
export function pickLocalized(text: LocalizedText, locale: Locale): string {
  return locale === "en" ? text.en : text.zhHK;
}

/** Adapt a catalog pair to a UI pair (same two passages, route-locale keys). */
export function localizedToBilingual(text: LocalizedText): Bilingual {
  return { en: text.en, "zh-HK": text.zhHK };
}

/* ------------------------------------------------------------------ */
/* Navigation and chrome                                               */
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

/** Endonym per locale: each language names itself in its own language. */
export const languageNames: Bilingual = {
  en: "English",
  "zh-HK": "繁體中文",
};

export const backToDrop: Bilingual = {
  en: "Back to the opening drop",
  "zh-HK": "返回首發登場",
};

/* ------------------------------------------------------------------ */
/* Homepage                                                            */
/* ------------------------------------------------------------------ */

export const heroEyebrow: Bilingual = {
  en: "The opening drop",
  "zh-HK": "首發登場",
};

/*
  Brand statement. The paired (secondary) line carries the HAVN name so each
  language reads as a full sentence when it is not the page language. The
  strings are pinned: the route tests bind the language attributes to these
  exact prefixes (test/routes.test.mjs, language of parts).

  The second sentence is the site's only availability-location fact: it is
  worded about the whole opening drop ("the whole opening drop is physically
  in Hong Kong"), never as per-SKU stock, which only the stock badge may
  claim (review finding 2).
*/
export const heroLead: Bilingual = {
  en: "Curated designer homeware. The whole opening drop is physically in Hong Kong.",
  "zh-HK": "精選設計家居。整批首發燈飾俱在香港。",
};

export const heroLeadPaired: Bilingual = {
  en: "HAVN, curated designer homeware. The whole opening drop is physically in Hong Kong.",
  "zh-HK": "HAVN 精選設計家居。整批首發燈飾俱在香港。",
};

/* Drop framing (DROP-01: a numbered opening drop with real scarcity). */
export const dropFraming: Bilingual = {
  en: "The opening drop: 16 numbered pieces of Louis Poulsen lighting.",
  "zh-HK": "首發登場：16 件編號 Louis Poulsen 燈飾。",
};

export const piecesHeading: Bilingual = {
  en: "The pieces in the drop",
  "zh-HK": "首發燈飾系列",
};

export const trustStripLabel: Bilingual = {
  en: "Independent seller",
  "zh-HK": "獨立賣家",
};

export const enquiryIntro: Bilingual = {
  en: "Questions about a piece? Ask on WhatsApp.",
  "zh-HK": "對某件燈飾有疑問？WhatsApp 查詢。",
};

/* ------------------------------------------------------------------ */
/* Product page: trust block (TRUST-01, TRUST-02)                      */
/* ------------------------------------------------------------------ */

export const priceLabel: Bilingual = {
  en: "Price",
  "zh-HK": "售價",
};

/* (a) Independent-seller disclosure. The facts are fixed by TRUST-01 and
   LEGAL-01: never imply authorised-dealer status, trademarks to their owners. */
export const disclosureLabel: Bilingual = {
  en: "Independent seller",
  "zh-HK": "獨立賣家",
};

export const disclosure: Bilingual = {
  en: "HAVN is an independent seller and is not an authorised Louis Poulsen dealer. All trademarks belong to their owners.",
  "zh-HK":
    "HAVN 為獨立賣家，並非 Louis Poulsen 授權經銷商。所有商標均屬其擁有者。",
};

/* (b) Warranty. The offered terms are a founder open item (Vision.md open
   item 1): this is honest pending copy in HAVN's own words, never a quoted or
   invented manufacturer warranty. The pending phrase "still being finalised"
   is asserted by test/pages.test.mjs. */
export const warrantyLabel: Bilingual = {
  en: "Warranty",
  "zh-HK": "保養",
};

export const warrantyPending: Bilingual = {
  en: "HAVN gives its own warranty on every piece it sells. The exact terms are still being finalised and will be published here before the first sale, in HAVN wording. The Louis Poulsen manufacturer warranty is never quoted as the HAVN warranty.",
  "zh-HK":
    "HAVN 為所售出的每件燈飾提供自家保養。具體條款仍在釐定中，將以 HAVN 自己的用詞於首宗銷售前在此公佈。Louis Poulsen 的原廠保養絕不會被引用為 HAVN 的保養條款。",
};

/* (c) Labelled reference price (TRUST-02: source + checked date). When the
   catalogue holds no verified reference, the UI says verification is pending
   instead of fabricating one. */
export const referenceLabel: Bilingual = {
  en: "Reference price, for comparison",
  "zh-HK": "參考價，作比較",
};

export const referenceSourceLabel: Bilingual = {
  en: "Source",
  "zh-HK": "來源",
};

export const referencePending: Bilingual = {
  en: "Reference price: verification pending. A comparison price is published here only once a real source has been checked and the check date recorded.",
  "zh-HK":
    "參考價：核實中。只有在核實真實來源並記錄查核日期後，比較價才會在此公佈。",
};

/* (d) Availability: intentionally no label and no sentence here (review
   finding 2). The product page trust block has no availability entry: the
   confirmed "N left" badge beside the price is the only per-SKU availability
   claim, and the drop-level Hong Kong fact lives in the homepage hero lead
   only. */

/* (e) Electrical copy comes from the catalogue (verified facts only). */
export const electricalLabel: Bilingual = {
  en: "Electrical",
  "zh-HK": "電器規格",
};

/* Below the fold: the heritage story (the lookbook inside the shop). */
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

/* The one signature interaction (lights on / lights off). The accessible name
   is deliberately bilingual (task requirement) and state is carried by
   aria-pressed, so the label itself stays static. */
export const lightsToggleLabel: Bilingual = {
  en: "Lights on / lights off",
  "zh-HK": "開燈 / 關燈",
};

export const artPlaceholderNote: Bilingual = {
  en: "Placeholder artwork",
  "zh-HK": "暫代圖片",
};

/** Accessible name for a placeholder artwork of `subject`. */
export function artLabel(subject: Bilingual): Bilingual {
  return {
    en: `${artPlaceholderNote.en} for ${subject.en}`,
    "zh-HK": `${subject["zh-HK"]} 的${artPlaceholderNote["zh-HK"]}`,
  };
}

/* ------------------------------------------------------------------ */
/* Stock badge labels (never a number in the unconfirmed state)        */
/* ------------------------------------------------------------------ */

export const stockLeft: BilingualFormatter<[n: number]> = {
  en: (n: number) => `${n} left`,
  "zh-HK": (n: number) => `尚餘 ${n} 件`,
};

export const stockSoldOut: Bilingual = {
  en: "Sold out",
  "zh-HK": "售罄",
};

export const stockUnconfirmed: Bilingual = {
  en: "Confirming availability",
  "zh-HK": "存貨確認中",
};

/* ------------------------------------------------------------------ */
/* Formatting helpers (all copy assembly for catalog data lives here)  */
/* ------------------------------------------------------------------ */

/** Model + colourway display name for one SKU. */
export function productDisplay(product: CatalogProduct): Bilingual {
  return {
    en: `${product.model} (${product.colourway.en})`,
    "zh-HK": `${product.modelAlt}（${product.colourway.zhHK}）`,
  };
}

/** Neutral meta description naming a product (review finding 2): a numbered
    piece of the opening drop from an independent seller. It must never claim
    the SKU is "in stock"; that claim belongs to the confirmed stock badge. */
export function productDescription(subject: Bilingual): Bilingual {
  return {
    en: `${subject.en}. A numbered piece of the HAVN opening drop of Louis Poulsen lighting. HAVN is an independent seller.`,
    "zh-HK": `${subject["zh-HK"]}，HAVN 首發登場的編號 Louis Poulsen 燈飾。HAVN 為獨立賣家。`,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Drop numbering (DROP-01): "Piece 03 of 16" for a single-piece SKU and
 * "Pieces 03-07 of 16" for a multi-unit SKU.
 */
export function dropNumbering(
  dropNumbers: readonly number[],
  totalPieces: number,
): Bilingual {
  const sorted = [...dropNumbers].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    throw new RangeError("dropNumbering: dropNumbers must not be empty");
  }

  const range = first === last ? pad2(first) : `${pad2(first)}-${pad2(last)}`;
  return first === last
    ? {
        en: `Piece ${range} of ${totalPieces}`,
        "zh-HK": `第 ${range} 件，共 ${totalPieces} 件`,
      }
    : {
        en: `Pieces ${range} of ${totalPieces}`,
        "zh-HK": `第 ${range} 件，共 ${totalPieces} 件`,
      };
}

/** Labelled reference price range ("HK$1,900 to HK$2,800"). */
export function referenceRange(ref: ReferencePrice): Bilingual {
  const min = formatHKD(ref.minCents);
  const max = formatHKD(ref.maxCents);
  return min === max
    ? { en: min, "zh-HK": max }
    : { en: `${min} to ${max}`, "zh-HK": `${min} 至 ${max}` };
}

/** The checked date of a labelled reference price. */
export function referenceChecked(ref: ReferencePrice): Bilingual {
  return {
    en: `checked ${ref.checkedAt}`,
    "zh-HK": `查核日期 ${ref.checkedAt}`,
  };
}

/**
 * Prefilled WhatsApp enquiry naming the subject (a product, or the drop on
 * the homepage). Bilingual in one message: both languages, one enquiry.
 */
export function enquiryMessage(subject: Bilingual): string {
  return [
    `Hi HAVN, I would like to ask about ${subject.en}.`,
    `你好 HAVN，我想查詢 ${subject["zh-HK"]}。`,
  ].join("\n\n");
}

/** Generic enquiry subject for entries that name no single product. */
export const dropEnquirySubject: Bilingual = {
  en: "the opening drop of Louis Poulsen lighting",
  "zh-HK": "Louis Poulsen 首發燈飾系列",
};

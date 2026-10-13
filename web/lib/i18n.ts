/**
 * Locale registry for the HAVN storefront.
 *
 * Traditional Chinese and English are first-class and equal weight from the
 * first component (Vision.md I18N-01). Routes are /en and /zh-HK; anything
 * else is a 404 (see app/[lang]/layout.tsx).
 */

export const locales = ["en", "zh-HK"] as const;

export type Locale = (typeof locales)[number];

/** Value for the <html lang> attribute per route locale. */
export const htmlLang: Record<Locale, string> = {
  en: "en",
  "zh-HK": "zh-Hant-HK",
};

/**
 * Locale used when no route locale applies: the bare 404 shell
 * (app/global-not-found.tsx) serves URLs that match no route tree at all,
 * so it cannot know the visitor's locale. English is the documented default
 * (review finding: unmatched routes -> <html lang="en">).
 */
export const defaultLocale: Locale = "en";

/** The other locale of a bilingual pair (paired copy carries both). */
export function altLocale(lang: Locale): Locale {
  return lang === "en" ? "zh-HK" : "en";
}

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

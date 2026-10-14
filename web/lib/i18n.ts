/**
 * Locale registry for the storefront (LOCALE-01, I18N-01).
 *
 * The locale set is env-configurable (`NEXT_PUBLIC_LOCALES`, default
 * "en,zh-HK"): the white-label test swaps env values, not code, so another
 * company runs their own language pair without touching this file.
 *
 * The storefront serves exactly two language editions, ONE first-class
 * language per page (I18N-01 as re-decided by the founder 2026-10-14: every
 * passage renders the chosen locale's text only), so the model is exactly
 * two locales: parsing validates that and fails loudly otherwise. The first
 * locale is the default (used by the bare 404 shell, which cannot know the
 * visitor's locale).
 *
 * Language metadata (BCP-47 tags for <html lang>, endonyms for the language
 * switcher) is locale metadata, not company data: it stays in code with a
 * built-in table plus identity fallbacks for any valid locale.
 */

/**
 * Parse a BCP-47-ish locale tag: 2-3 lowercase letters, optionally followed by
 * script/region subtags (e.g. "en", "zh-HK", "zh-Hant-HK", "pt-BR").
 */
const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Raw env value -> the validated locale pair, or a descriptive error. */
export function parseLocales(raw: string | undefined): [string, string] {
  const value = raw?.trim() ?? "";
  const source = value === "" ? "en,zh-HK" : value;
  const parts = source
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  const invalid = parts.find((part) => !LOCALE_PATTERN.test(part));
  if (invalid !== undefined) {
    throw new Error(
      `parseLocales: invalid locale "${invalid}" in NEXT_PUBLIC_LOCALES ` +
        "(expected BCP-47 style tags like en, zh-HK).",
    );
  }
  if (parts.length !== 2) {
    throw new Error(
      "parseLocales: NEXT_PUBLIC_LOCALES must name exactly two locales " +
        `(the storefront serves two language editions); got ${parts.length} ` +
        `(${parts.join(", ") || "empty"}).`,
    );
  }
  const [first, second] = parts;
  if (first === undefined || second === undefined) {
    // Unreachable after the length check; kept for the type checker.
    throw new Error("parseLocales: expected exactly two locales.");
  }
  if (first === second) {
    throw new Error(
      `parseLocales: NEXT_PUBLIC_LOCALES must not repeat a locale ("${first}").`,
    );
  }
  return [first, second];
}

/** The configured locale pair, resolved once at load (build or request). */
export const locales = parseLocales(process.env.NEXT_PUBLIC_LOCALES) as readonly [
  string,
  string,
];

export type Locale = (typeof locales)[number];

/** Built-in <html lang> values: script/region precision where it matters. */
const HTML_LANG: Record<string, string> = {
  en: "en",
  "zh-HK": "zh-Hant-HK",
};

/** Value for the <html lang> attribute per route locale. */
export const htmlLang: Record<Locale, string> = {
  [locales[0]]: HTML_LANG[locales[0]] ?? locales[0],
  [locales[1]]: HTML_LANG[locales[1]] ?? locales[1],
};

/** Built-in endonyms for the language switcher (each language names itself). */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  "zh-HK": "繁體中文",
};

/** Endonym per locale: each language names itself in its own language. */
export const languageNames: Record<Locale, string> = {
  [locales[0]]: LANGUAGE_NAMES[locales[0]] ?? locales[0],
  [locales[1]]: LANGUAGE_NAMES[locales[1]] ?? locales[1],
};

/**
 * Locale used when no route locale applies: the bare 404 shell
 * (app/global-not-found.tsx) serves URLs that match no route tree at all,
 * so it cannot know the visitor's locale. The first configured locale is the
 * documented default.
 */
export const defaultLocale: Locale = locales[0];

/** The other configured locale (language switcher and routing helpers). */
export function altLocale(lang: Locale): Locale {
  return lang === locales[0] ? locales[1] : locales[0];
}

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/**
 * Fail-soft 404 content loader.
 *
 * The 404 shells must NEVER fail the build or turn a 404 into a 500: a page
 * that cannot find its copy falls back to generic, brand-free copy rather
 * than throwing (the opposite of the fail-loud catalogue contract, which is
 * correct there and wrong here — a 404 is not rendered from unconfirmed
 * company data, it is a shell whose only job is "not found + language
 * links").
 *
 * Success path: site content (notFound.title, notFound.description,
 * notFound.body) + settings, rendered with the resolved brand. The copy is
 * kept PER LOCALE (404 copy from the DB per locale); each shell renders its
 * ONE locale's text (single-locale display, founder 2026-10-14).
 *
 * SINGLE-LANGUAGE FALLBACKS (review findings): the generic copy is defined
 * PER LOCALE, and a locale whose company rows are missing gets ITS OWN
 * locale's generic copy — never another locale's text (a zh-HK shell must
 * never render English company copy marked zh, and the fallback titles are
 * single-language: the old "Page not found / 找不到頁面" bilingual literal
 * showed both languages in the browser tab under a single <html lang>).
 * Failure path (API down, brand unresolvable): every locale falls back to
 * its generic copy.
 */
import { renderTemplate, requireApiUrl, resolveSiteConfig } from "./config.ts";
import {
  fetchSettings,
  fetchSiteContent,
  type FetchLike,
  type SiteContent,
} from "./catalog-client.ts";
import { locales } from "./i18n.ts";

/** Generic, brand-free fallback copy per locale (the cannot-fetch case and
 * the per-locale missing-row case). Kept here (not in the component) so
 * unit tests can import it without a JSX transform; the component imports
 * it from here. */
export const GENERIC_404_TITLE: Record<string, string> = {
  en: "Page not found",
  "zh-HK": "找不到頁面",
};

export const GENERIC_404_DESCRIPTION: Record<string, string> = {
  en: "Page not found. The two language editions are linked below.",
  "zh-HK": "找不到頁面。以下連結前往兩個語言版本。",
};

export const GENERIC_404_BODY: Record<string, string> = {
  en: "This page does not exist. The two language editions are linked below.",
  "zh-HK": "此頁面不存在。以下連結前往兩個語言版本。",
};

/** Per-locale 404 copy, rendered and ready for the shells. Every
 * configured locale is always present (single-language per locale). */
export interface NotFoundData {
  title: Record<string, string>;
  description: Record<string, string>;
  body: Record<string, string>;
}

/**
 * Strict per-locale read (review finding: NO cross-locale fallback): a
 * locale gets a value only if ITS OWN row exists. A missing locale is
 * filled with its own generic copy at assembly, so a zh-HK shell can never
 * render an English passage marked zh (mixed-language content).
 */
function perLocaleStrict(
  content: SiteContent,
  key: string,
  brand: string,
): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const locale of locales) {
    const template = content[key]?.[locale];
    if (template !== undefined) {
      out[locale] = renderTemplate(template, { brand });
    }
  }
  return out;
}

/** Fill every configured locale, missing ones with THEIR OWN generic copy. */
function withGenericPerLocale(
  found: Partial<Record<string, string>>,
  generic: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of locales) {
    // The generic maps cover the supported pair (LOCALE-02), so the final
    // "" is unreachable defense against an exotic pair, never a real path.
    out[locale] = found[locale] ?? generic[locale] ?? generic.en ?? "";
  }
  return out;
}

/**
 * Load 404 copy for the shells. NEVER THROWS: any failure (API env missing,
 * API unreachable, unresolvable brand, missing content keys) yields the
 * generic fallback. The API URL is resolved INSIDE the try so a missing
 * NEXT_PUBLIC_API_URL degrades to the fallback instead of throwing out of
 * the loader (normal pages still fail loudly on a missing API URL).
 */
export async function loadNotFoundData(
  fetchImpl: FetchLike = fetch,
): Promise<NotFoundData> {
  try {
    const apiUrl = requireApiUrl();
    const [content, overrides] = await Promise.all([
      fetchSiteContent(apiUrl, fetchImpl),
      fetchSettings(apiUrl, fetchImpl),
    ]);
    const config = resolveSiteConfig(overrides);

    const body = perLocaleStrict(content, "notFound.body", config.brandName);
    if (Object.keys(body).length === 0) {
      // Content keys missing entirely: generic fallback rather than empty copy.
      return fallbackData();
    }
    return {
      title: withGenericPerLocale(
        perLocaleStrict(content, "notFound.title", config.brandName),
        GENERIC_404_TITLE,
      ),
      description: withGenericPerLocale(
        perLocaleStrict(content, "notFound.description", config.brandName),
        GENERIC_404_DESCRIPTION,
      ),
      body: withGenericPerLocale(body, GENERIC_404_BODY),
    };
  } catch {
    return fallbackData();
  }
}

/** The generic, brand-free fallback set (single-language per locale). */
export function fallbackData(): NotFoundData {
  return {
    title: withGenericPerLocale({}, GENERIC_404_TITLE),
    description: withGenericPerLocale({}, GENERIC_404_DESCRIPTION),
    body: withGenericPerLocale({}, GENERIC_404_BODY),
  };
}
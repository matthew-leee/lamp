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
 * notFound.body) + settings, rendered with the resolved brand.
 * Failure path (API down, brand unresolvable, content keys missing): the
 * generic fallback copy in lib/not-found-data.ts (GENERIC_404_BODY).
 */
import { renderTemplate, requireApiUrl, resolveSiteConfig } from "./config.ts";
import {
  fetchSettings,
  fetchSiteContent,
  type FetchLike,
  type SiteContent,
} from "./catalog-client.ts";
import { locales } from "./i18n.ts";

/** Generic, brand-free fallback body copy (the cannot-fetch case). Kept
 * here (not in the component) so unit tests can import it without a JSX
 * transform; the component imports it from here. */
export const GENERIC_404_BODY: Record<string, string> = {
  en: "This page does not exist. The two language editions are linked below.",
  "zh-HK": "此頁面不存在。以下連結前往兩個語言版本。",
};

/** Per-locale 404 copy, rendered and ready for the shells. */
export interface NotFoundData {
  title: Record<string, string>;
  description: Record<string, string>;
  body: Record<string, string>;
}

/** Generic fallback metadata (locale-neutral, brand-free). */
const FALLBACK_TITLE = "Page not found / 找不到頁面";
const FALLBACK_DESCRIPTION =
  "Page not found. 找不到頁面。The two language editions are linked below.";

/** Per-locale lookup with first-locale fallback. */
function perLocale(
  content: SiteContent,
  key: string,
  brand: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const locale of locales) {
    const template = content[key]?.[locale] ?? content[key]?.[locales[0]];
    if (template !== undefined) {
      out[locale] = renderTemplate(template, { brand });
    }
  }
  return out;
}

/** Fetch-like (injectable for the unit tests). */

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

    const title = perLocale(content, "notFound.title", config.brandName);
    const description = perLocale(
      content,
      "notFound.description",
      config.brandName,
    );
    const body = perLocale(content, "notFound.body", config.brandName);

    if (Object.keys(body).length === 0) {
      // Content keys missing entirely: generic fallback rather than empty copy.
      return fallbackData();
    }
    return {
      title: Object.keys(title).length > 0 ? title : { [locales[0]]: FALLBACK_TITLE },
      description:
        Object.keys(description).length > 0
          ? description
          : { [locales[0]]: FALLBACK_DESCRIPTION },
      body,
    };
  } catch {
    return fallbackData();
  }
}

/** The generic, brand-free fallback set. */
export function fallbackData(): NotFoundData {
  const title: Record<string, string> = {};
  const description: Record<string, string> = {};
  for (const locale of locales) {
    title[locale] = FALLBACK_TITLE;
    description[locale] = FALLBACK_DESCRIPTION;
  }
  return { title, description, body: { ...GENERIC_404_BODY } };
}

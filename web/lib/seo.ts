/**
 * SEO surface helpers (T4): absolute URLs, hreflang/canonical maps and
 * Product JSON-LD.
 *
 * All URLs derive from the canonical site URL (lib/config.ts
 * requiredSiteUrl, required from T4). JSON-LD rules:
 *
 * - `price` is ALWAYS present: the catalogue price in the configured
 *   currency, formatted as a string with integer math ("1615.50"), never a
 *   float (money is integer cents end to end; division would round).
 * - `availability` is deliberately OMITTED. Stock is live data with a hard
 *   fail-closed channel (/api/products -> /api/availability -> the 60s-TTL
 *   client badge; commitment 5b: SSR HTML never carries a stock number), and
 *   JSON-LD is baked into the static page at build time. An `InStock` claim
 *   here would be an unconfirmed stock statement in server-rendered HTML —
 *   exactly what 5b forbids — so the honest shape omits it. If confirmed
 *   availability ever needs to reach structured data, it must come from the
 *   same fail-closed live channel, not the build-time catalogue.
 *
 * hreflang uses the document language values (lib/i18n.ts htmlLang: "en",
 * "zh-Hant-HK"), which describe the CONTENT language, plus x-default pointing
 * at the default locale.
 */

import type { CatalogueProduct } from "./catalog-client.ts";
import { requiredSiteUrl, type SiteConfig } from "./config.ts";
import { htmlLang, locales, type Locale } from "./i18n.ts";
import { productDisplay } from "./ui-copy.ts";

/** An absolute site URL: `siteUrl` (no trailing slash) + `path` (no leading). */
export function absoluteUrl(siteUrl: string, path: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** The absolute URL of one locale's home page. */
export function localeUrl(siteUrl: string, locale: string): string {
  return absoluteUrl(siteUrl, locale);
}

/** The absolute URL of one product page in one locale. */
export function productUrl(
  siteUrl: string,
  locale: string,
  slug: string,
): string {
  return absoluteUrl(siteUrl, `${locale}/products/${slug}`);
}

/**
 * The canonical + hreflang map for one page path (same path shape for both
 * locales: a locale home "", or `products/slug`). Canonical is the CURRENT
 * page's own absolute URL (self-referencing, per Google's spec); languages
 * covers both locales (htmlLang values) plus x-default (the first configured
 * locale, the documented default).
 */
export function alternatesFor(
  config: SiteConfig,
  pagePath: string,
  currentLocale: string,
): {
  canonical: string;
  languages: Record<string, string>;
} {
  const siteUrl = requiredSiteUrl(config);
  const languages: Record<string, string> = {};
  for (const locale of locales) {
    languages[htmlLang[locale] ?? locale] = absoluteUrl(
      siteUrl,
      `${locale}${pagePath === "" ? "" : `/${pagePath}`}`,
    );
  }
  const defaultPage = absoluteUrl(
    siteUrl,
    `${locales[0]}${pagePath === "" ? "" : `/${pagePath}`}`,
  );
  languages["x-default"] = defaultPage;
  return {
    canonical: absoluteUrl(
      siteUrl,
      `${currentLocale}${pagePath === "" ? "" : `/${pagePath}`}`,
    ),
    languages,
  };
}

/**
 * The JSON-LD price string: integer cents -> "1615.50" (two minor digits,
 * the documented data-model constraint; no float ever touches a price).
 */
function jsonLdPrice(priceCents: number): string {
  const whole = Math.floor(priceCents / 100);
  const minor = priceCents % 100;
  return `${whole}.${String(minor).padStart(2, "0")}`;
}

/** Product JSON-LD for one SKU page (see the module doc for the rules). */
export function productJsonLd(input: {
  product: CatalogueProduct;
  locale: Locale;
  config: SiteConfig;
}): Record<string, unknown> {
  const { product, locale, config } = input;
  const siteUrl = requiredSiteUrl(config);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: productDisplay(product, locale),
    sku: product.slug,
    brand: { "@type": "Brand", name: product.brand },
    offers: {
      "@type": "Offer",
      url: productUrl(siteUrl, locale, product.slug),
      price: jsonLdPrice(product.priceCents),
      priceCurrency: config.currency,
      // availability: deliberately omitted (module doc: unconfirmed stock
      // claims in SSR HTML are forbidden by commitment 5b).
    },
  };
}
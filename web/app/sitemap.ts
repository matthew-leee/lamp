import type { MetadataRoute } from "next";

import { fetchCatalogue, fetchSettings } from "@/lib/catalog-client";
import { requireApiUrl, requiredSiteUrl, resolveSiteConfig } from "@/lib/config";
import { locales } from "@/lib/i18n";
import { localeUrl, productUrl } from "@/lib/seo";

/**
 * Sitemap (T4): one entry per locale home page and per active product page
 * per locale, absolute URLs from the canonical site URL (required:
 * requiredSiteUrl via productUrl/localeUrl). Build-time data: the catalogue
 * is fetched from the API like every other page (DATA-02); the file
 * regenerates on redeploy/revalidation. `lastModified` is deliberately
 * omitted: nothing in the data model tracks content mtime, and a fabricated
 * "changed today" date would be dishonest.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const apiUrl = requireApiUrl();
  const [catalogue, overrides] = await Promise.all([
    fetchCatalogue(apiUrl),
    fetchSettings(apiUrl),
  ]);
  const config = resolveSiteConfig(overrides);
  const siteUrl = requiredSiteUrl(config);

  const entries: MetadataRoute.Sitemap = [];
  for (const locale of locales) {
    entries.push({
      url: localeUrl(siteUrl, locale),
      changeFrequency: "weekly",
      priority: 0.8,
    });
    for (const product of catalogue.products) {
      entries.push({
        url: productUrl(siteUrl, locale, product.slug),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  }
  return entries;
}
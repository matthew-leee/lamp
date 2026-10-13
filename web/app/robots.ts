import type { MetadataRoute } from "next";

import { fetchSettings } from "@/lib/catalog-client";
import { requiredSiteUrl, resolveSiteConfig } from "@/lib/config";
import { absoluteUrl } from "@/lib/seo";

/**
 * Robots (T4): allow everything public, keep the API routes out of the
 * index, and point at the sitemap with an absolute URL from the canonical
 * site URL (required).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!apiUrl) {
    throw new Error(
      "robots: NEXT_PUBLIC_API_URL is required (settings fetch for the " +
        "canonical site URL).",
    );
  }
  const overrides = await fetchSettings(apiUrl);
  const config = resolveSiteConfig(overrides);
  const siteUrl = requiredSiteUrl(config);

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: absoluteUrl(siteUrl, "sitemap.xml"),
  };
}
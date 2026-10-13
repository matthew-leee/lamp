import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  Fraunces,
  Noto_Sans_TC,
  Noto_Serif_TC,
  Space_Grotesk,
} from "next/font/google";

import AvailabilityProvider from "@/components/availability-context";
import AnalyticsScripts from "@/components/analytics";
import { htmlLang, isLocale, locales, type Locale } from "@/lib/i18n";
import {
  availabilityTtlMs,
  fetchTimeoutMs,
  renderTemplate,
  requireApiUrl,
  resolveSiteConfig,
} from "@/lib/config";
import {
  contentValue,
  fetchCatalogue,
  fetchSettings,
  fetchSiteContent,
} from "@/lib/catalog-client";
import { alternatesFor } from "@/lib/seo";
import SiteFooter from "@/components/site-footer";
import SiteHeader from "@/components/site-header";
import "../globals.css";

/*
  Type pairing (docs/designs/havn-opening-drop.md): display serif plus
  grotesque for Latin, Noto Serif TC plus Noto Sans TC for Chinese. All four
  are variable fonts exposed as CSS variables and composed in globals.css.

  Data (DATA-02/CONFIG-01): the shared chrome resolves its configuration at
  build time — settings overrides over env defaults (brand), and company copy
  (disclosure, footer location, home metadata) from the site_content table.
  Locale routing: the configured locale pair is generated at build time.
  Any other locale or path is a 404. No middleware by design (T1 decision).
*/
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const notoSerifTC = Noto_Serif_TC({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-serif-tc",
});

const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-sans-tc",
});

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

type RootLayoutProps = {
  children: ReactNode;
  params: Promise<{ lang: string }>;
};

/** Shared chrome data: resolved config + the copy the chrome renders. */
async function loadChromeData() {
  const apiUrl = requireApiUrl();
  const [catalogue, content, overrides] = await Promise.all([
    fetchCatalogue(apiUrl),
    fetchSiteContent(apiUrl),
    fetchSettings(apiUrl),
  ]);
  const config = resolveSiteConfig(overrides);
  return { catalogue, content, config };
}

export default async function RootLayout({
  children,
  params,
}: RootLayoutProps) {
  const { lang } = await params;
  if (!isLocale(lang)) {
    notFound();
  }
  const locale: Locale = lang;
  const { content, config } = await loadChromeData();

  // The disclosure and footer location are company copy: per-locale values
  // rendered with the resolved brand (DATA-02; the footer renders both).
  // footer.location is REQUIRED content (fail-loud: a missing location row
  // must not silently drop the footer line).
  const disclosure: Record<string, string> = {};
  const location: Record<string, string> = {};
  for (const l of locales) {
    disclosure[l] = renderTemplate(
      contentValue(content, "trust.disclosure", l),
      { brand: config.brandName },
    );
    location[l] = contentValue(content, "footer.location", l);
  }

  return (
    <html
      lang={htmlLang[locale]}
      className={[
        fraunces.variable,
        spaceGrotesk.variable,
        notoSerifTC.variable,
        notoSansTC.variable,
      ].join(" ")}
    >
      <body className="min-h-dvh bg-bone font-sans text-charcoal antialiased">
        {/* Shared chrome (T3): every page carries the header and the footer
            disclosure in both languages (TRUST-01). */}
        <SiteHeader
          lang={locale}
          brandName={config.brandName}
          brandNameNative={config.brandNameNative}
        />
        {/* Live availability provider (commitment 5b): SSR HTML never carries
            stock numbers; badges confirm them client-side via /api/availability.
            Kept inside the header/footer so the shared chrome stays static.
            TTL/timeout are resolved on the SERVER and passed as props: Next
            only inlines statically named public env accesses into client
            bundles, so the browser cannot resolve the env knobs itself. */}
        <AvailabilityProvider ttlMs={availabilityTtlMs()} timeoutMs={fetchTimeoutMs()}>
          {children}
        </AvailabilityProvider>
        <SiteFooter
          lang={locale}
          disclosure={disclosure}
          location={location}
          brandName={config.brandName}
        />
        {/* GA4 (T4, GA-OFF-01): renders nothing unless a valid measurement ID
            is configured; the C8 privacy check gates turning it on. */}
        <AnalyticsScripts gaMeasurementId={config.gaMeasurementId} />
      </body>
    </html>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale: Locale = isLocale(lang) ? lang : locales[0];
  const { catalogue, content, config } = await loadChromeData();
  const pieces = String(catalogue.totalPieces);

  // Metadata is neutral (review finding 2): it may state the drop-level fact
  // that the whole opening drop is physically in Hong Kong, never that a SKU
  // is "in stock" (the confirmed stock badge alone may say that). {pieces}
  // renders from the catalogue COUNT, never a prose constant.
  const title = renderTemplate(
    contentValue(content, "meta.home.title", locale),
    { brand: config.brandName, pieces },
  );
  const description = renderTemplate(
    contentValue(content, "meta.home.description", locale),
    { brand: config.brandName, pieces },
  );

  return {
    title,
    description,
    // Canonical + hreflang (T4): absolute URLs from the canonical site URL.
    alternates: alternatesFor(config, "", locale),
    // Search Console verification (T4): meta tag only when a token is
    // configured (GA-OFF-01: empty config renders nothing).
    verification:
      config.gscVerification !== null
        ? { google: config.gscVerification }
        : undefined,
  };
}

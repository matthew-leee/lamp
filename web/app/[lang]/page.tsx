/**
 * Editorial homepage (Vision.md BRAND-01, DROP-01).
 *
 * "A lookbook with a shop inside it": one hero lamp, lit, then the numbered
 * opening drop as a spacious gallery, then trust. Not a centred hero over
 * three feature cards (docs/designs/havn-opening-drop.md: generic ecommerce
 * slop is a conversion problem here, not a style preference).
 *
 * Data (DATA-02/CONFIG-01): the drop grid renders the FETCHED catalogue
 * (Postgres via the Rust API, fail-loud at build); hero, framing and trust
 * copy are company copy from the site_content table rendered with the
 * resolved brand; prices render in the configured currency. The drop total is
 * the catalogue's derived COUNT, never a constant.
 *
 * Copy rules (I18N-01): both languages at equal weight, each passage with its
 * own lang attribute (WCAG 3.1.2), shared type class per pair so neither
 * language is the smaller translation. No em-dashes.
 *
 * Stock badges are client components (commitment 5b, review finding 1): SSR
 * HTML never contains a stock number. Badges render the number-free
 * "Confirming availability" placeholder until they confirm live counts from
 * /api/availability in the browser, then render lib/stock.ts decisions only.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import PlaceholderArt from "@/components/placeholder-art";
import StockBadge from "@/components/stock-badge";
import WhatsAppButton from "@/components/whatsapp-button";
import { familyClass } from "@/components/bilingual";
import {
  contentValue,
  fetchCatalogue,
  fetchSettings,
  fetchSiteContent,
  type SiteContent,
} from "@/lib/catalog-client";
import { renderTemplate, requireApiUrl, resolveSiteConfig } from "@/lib/config";
import { altLocale, htmlLang, isLocale, locales, type Locale } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import {
  artLabel,
  buildEnquiryMessage,
  dropNumbering,
  productDisplay,
  trustStripLabel,
  type Bilingual,
} from "@/lib/ui-copy";

/* Shared type class per pair: both languages at the same size, weight and
   contrast (I18N-01). */
const leadClass = "text-4xl leading-[1.35] text-charcoal sm:text-5xl";

/* Collection heading pair (I18N-01): ONE class list shared by both languages. */
const collectionHeadingClass = "text-2xl text-charcoal font-display-pair";

type HomePageProps = {
  params: Promise<{ lang: string }>;
};

/** Read one site-content key as a rendered bilingual pair (fail-loud).
 * Rendered vars: {brand} and, for copy that names the drop size, {pieces} =
 * the catalogue-derived total (COUNT, never a prose constant). */
function contentPair(
  content: SiteContent,
  key: string,
  brand: string,
  pieces: number,
): Bilingual {
  const out: Bilingual = {};
  for (const locale of locales) {
    out[locale] = renderTemplate(contentValue(content, key, locale), {
      brand,
      pieces: String(pieces),
    });
  }
  return out;
}

export default async function HomePage({ params }: HomePageProps) {
  const { lang } = await params;
  if (!isLocale(lang)) {
    notFound();
  }
  const locale: Locale = lang;
  const alt = altLocale(locale);

  const apiUrl = requireApiUrl();
  const [catalogue, content, overrides] = await Promise.all([
    fetchCatalogue(apiUrl),
    fetchSiteContent(apiUrl),
    fetchSettings(apiUrl),
  ]);
  const config = resolveSiteConfig(overrides);

  // Company copy from site content, rendered with the brand and the derived
  // drop size (DATA-02: the count in prose comes from the COUNT, not prose).
  const totalPieces = catalogue.totalPieces;
  const heroEyebrowPair = contentPair(content, "hero.eyebrow", config.brandName, totalPieces);
  const heroLeadPair = contentPair(content, "hero.lead", config.brandName, totalPieces);
  const heroLeadPairedPair = contentPair(
    content,
    "hero.leadPaired",
    config.brandName,
    totalPieces,
  );
  const dropFramingPair = contentPair(content, "drop.framing", config.brandName, totalPieces);
  const piecesHeadingPair = contentPair(
    content,
    "drop.piecesHeading",
    config.brandName,
    totalPieces,
  );
  const disclosurePair = contentPair(
    content,
    "trust.disclosure",
    config.brandName,
    totalPieces,
  );
  const enquiryIntroPair = contentPair(content, "enquiry.intro", config.brandName, totalPieces);
  const dropSubjectPair = contentPair(
    content,
    "enquiry.dropSubject",
    config.brandName,
    totalPieces,
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      {/* Hero: asymmetric editorial, the lamp lit. */}
      <section className="grid gap-12 pt-16 lg:grid-cols-12 lg:gap-16 lg:pt-24">
        <div className="lg:col-span-7">
          <p
            className={`text-sm tracking-[0.22em] text-ink-soft ${familyClass(locale, "sans")}`}
            lang={htmlLang[locale]}
          >
            {heroEyebrowPair[locale]}
          </p>
          <h1
            className={`mt-6 ${leadClass} ${familyClass(locale, "display")}`}
            lang={htmlLang[locale]}
          >
            {heroLeadPair[locale]}
          </h1>
          <p
            className={`mt-6 ${leadClass} ${familyClass(alt, "display")}`}
            lang={htmlLang[alt]}
          >
            {heroLeadPairedPair[alt]}
          </p>
          <p className={`mt-10 text-lg text-charcoal ${familyClass(locale, "sans")}`}>
            <span lang={htmlLang[locale]}>{dropFramingPair[locale]}</span>
            <span aria-hidden="true" className="px-2 text-linen">
              /
            </span>
            <span lang={htmlLang[alt]}>{dropFramingPair[alt]}</span>
          </p>
        </div>

        <div className="lg:col-span-5">
          {/* Hero art from product data (no inline hue/variant fallback:
             the catalogue is non-empty by the fetchCatalogue contract). */}
          <PlaceholderArt
            lit
            hue={catalogue.products[0]!.art.hue}
            variant={catalogue.products[0]!.art.variant}
            label={artLabel(dropSubjectPair, locale)}
          />
        </div>
      </section>

      {/* The numbered drop: the active catalogue, one tile per SKU. */}
      <section className="mt-28">
        {/* Equal-typography collection heading pair (I18N-01). */}
        <div className="space-y-2">
          <h2 className={collectionHeadingClass} lang={htmlLang[locale]}>
            {piecesHeadingPair[locale]}
          </h2>
          <p className={collectionHeadingClass} lang={htmlLang[alt]}>
            {piecesHeadingPair[alt]}
          </p>
        </div>

        <ul className="mt-12 grid gap-x-10 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
          {catalogue.products.map((product) => {
            const name: Bilingual = {};
            const pieces: Bilingual = {};
            for (const l of locales) {
              name[l] = productDisplay(product, l);
              pieces[l] = dropNumbering(
                product.pieces,
                catalogue.totalPieces,
                l,
              );
            }
            return (
              <li key={product.slug}>
                <Link
                  href={`/${locale}/products/${product.slug}`}
                  className="group block transition-colors duration-200"
                >
                  <PlaceholderArt
                    lit
                    hue={product.art.hue}
                    variant={product.art.variant}
                  />
                  <p
                    className={`mt-5 text-xs tracking-[0.18em] text-ink-soft ${familyClass(locale, "sans")}`}
                  >
                    <span lang={htmlLang[locale]}>{pieces[locale]}</span>
                    <span aria-hidden="true" className="px-1.5 text-linen">
                      /
                    </span>
                    <span lang={htmlLang[alt]}>{pieces[alt]}</span>
                  </p>
                  <h3 className="mt-2 text-lg leading-snug text-charcoal">
                    <span lang={htmlLang[locale]} className={familyClass(locale, "sans")}>
                      {name[locale]}
                    </span>
                    <span aria-hidden="true" className="px-2 text-linen">
                      /
                    </span>
                    <span lang={htmlLang[alt]} className={familyClass(alt, "sans")}>
                      {name[alt]}
                    </span>
                  </h3>
                  <p className="mt-3 text-2xl text-charcoal font-sans">
                    {formatMoney(product.priceCents, config.currency)}
                  </p>
                  <div className="mt-3">
                    <StockBadge
                      slug={product.slug}
                      unitsInDrop={product.unitsInDrop}
                      lang={locale}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Trust strip: who the seller is, in both languages. */}
      <section className="mt-28 border-t border-sand pt-12">
        <p
          className={`text-sm tracking-[0.22em] text-ink-soft ${familyClass(locale, "sans")}`}
          lang={htmlLang[locale]}
        >
          {trustStripLabel[locale] ?? trustStripLabel.en}
        </p>
        <p
          className={`mt-4 max-w-3xl text-lg leading-relaxed text-charcoal ${familyClass(locale, "sans")}`}
          lang={htmlLang[locale]}
        >
          {disclosurePair[locale]}
        </p>
        <p
          className={`mt-3 max-w-3xl text-lg leading-relaxed text-charcoal ${familyClass(alt, "sans")}`}
          lang={htmlLang[alt]}
        >
          {disclosurePair[alt]}
        </p>
      </section>

      {/* WhatsApp enquiry entry (renders nothing without a confirmed number). */}
      <section className="mt-20">
        <p className={`text-xl text-charcoal ${familyClass(locale, "display")}`}>
          <span lang={htmlLang[locale]}>{enquiryIntroPair[locale]}</span>
          <span aria-hidden="true" className="px-2 text-linen">
            /
          </span>
          <span lang={htmlLang[alt]}>{enquiryIntroPair[alt]}</span>
        </p>
        <div className="mt-6">
          <WhatsAppButton
            number={config.whatsappNumber}
            message={buildEnquiryMessage(
              content,
              config.brandName,
              dropSubjectPair,
            )}
          />
        </div>
      </section>
    </main>
  );
}

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
 * Copy rules (I18N-01, founder decision 2026-10-14): SINGLE-LOCALE DISPLAY.
 * Every passage renders ONLY the chosen locale's text, one passage per key,
 * each with its own lang attribute (WCAG 3.1.2 Language of Parts) and the
 * script-aware type family for that locale (components/bilingual.tsx). The
 * old paired-equal-weight display (every passage in both languages) is
 * RETIRED. No em-dashes.
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
import { htmlLang, isLocale, type Locale } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import {
  artLabel,
  buildEnquiryMessage,
  dropNumbering,
  pick,
  productDisplay,
  trustStripLabel,
} from "@/lib/ui-copy";

/* Shared type class for the hero lead passages: same size, weight and
   contrast (I18N-01); both now render the chosen locale only. */
const leadClass = "text-4xl leading-[1.35] text-charcoal sm:text-5xl";

/* Collection heading (I18N-01): one heading; the display-pair token is a
   script-aware display stack (Latin Fraunces, Han Noto Serif TC), so the
   chosen locale's script gets the right family from one class list. */
const collectionHeadingClass = "text-2xl text-charcoal font-display-pair";

type HomePageProps = {
  params: Promise<{ lang: string }>;
};

/**
 * Read one site-content key as the CHOSEN locale's rendered string (fail-loud).
 * Single-locale display (founder 2026-10-14): the page builds only the chosen
 * locale's text, never a both-locales pair, and the JSX renders one passage
 * per key with its lang attribute. Rendered vars: {brand} and, for copy that
 * names the drop size, {pieces} = the catalogue-derived total (COUNT, never a
 * prose constant). */
function contentText(
  content: SiteContent,
  key: string,
  locale: Locale,
  brand: string,
  pieces: number,
): string {
  return renderTemplate(contentValue(content, key, locale), {
    brand,
    pieces: String(pieces),
  });
}

export default async function HomePage({ params }: HomePageProps) {
  const { lang } = await params;
  if (!isLocale(lang)) {
    notFound();
  }
  const locale: Locale = lang;

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
  const heroEyebrow = contentText(content, "hero.eyebrow", locale, config.brandName, totalPieces);
  const heroLead = contentText(content, "hero.lead", locale, config.brandName, totalPieces);
  // Single hero lead (founder decision 2026-10-14): the old design rendered a
  // SECOND lead passage in the ALT locale ("paired lead"); with single-locale
  // display that would render two near-duplicate sentences in the SAME
  // language, so only `hero.lead` renders. `hero.leadPaired` stays SEEDED
  // DATA (admin-editable, another company may use it) — just not rendered.
  const dropFraming = contentText(content, "drop.framing", locale, config.brandName, totalPieces);
  const piecesHeading = contentText(content, "drop.piecesHeading", locale, config.brandName, totalPieces);
  const disclosure = contentText(content, "trust.disclosure", locale, config.brandName, totalPieces);
  const enquiryIntro = contentText(content, "enquiry.intro", locale, config.brandName, totalPieces);
  const dropSubject = contentText(content, "enquiry.dropSubject", locale, config.brandName, totalPieces);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      {/* Hero: asymmetric editorial, the lamp lit. */}
      <section className="grid gap-12 pt-16 lg:grid-cols-12 lg:gap-16 lg:pt-24">
        <div className="lg:col-span-7">
          <p
            className={`text-sm tracking-[0.22em] text-ink-soft ${familyClass(locale, "sans")}`}
            lang={htmlLang[locale]}
          >
            {heroEyebrow}
          </p>
          <h1
            className={`mt-6 ${leadClass} ${familyClass(locale, "display")}`}
            lang={htmlLang[locale]}
          >
            {heroLead}
          </h1>
          <p
            className={`mt-10 text-lg text-charcoal ${familyClass(locale, "sans")}`}
            lang={htmlLang[locale]}
          >
            {dropFraming}
          </p>
        </div>

        <div className="lg:col-span-5">
          {/* Hero art from product data (no inline hue/variant fallback:
             the catalogue is non-empty by the fetchCatalogue contract). */}
          <PlaceholderArt
            lit
            hue={catalogue.products[0]!.art.hue}
            variant={catalogue.products[0]!.art.variant}
            label={artLabel(dropSubject, locale)}
          />
        </div>
      </section>

      {/* The numbered drop: the active catalogue, one tile per SKU. */}
      <section className="mt-28">
        {/* One collection heading in the chosen language (I18N-01). */}
        <h2 className={collectionHeadingClass} lang={htmlLang[locale]}>
          {piecesHeading}
        </h2>

        <ul className="mt-12 grid gap-x-10 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
          {catalogue.products.map((product) => {
            const name = productDisplay(product, locale);
            const pieces = dropNumbering(
              product.pieces,
              catalogue.totalPieces,
              locale,
            );
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
                    lang={htmlLang[locale]}
                  >
                    {pieces}
                  </p>
                  <h3
                    className={`mt-2 text-lg leading-snug text-charcoal ${familyClass(locale, "sans")}`}
                    lang={htmlLang[locale]}
                  >
                    {name}
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

      {/* Trust strip: who the seller is, in the chosen language. */}
      <section className="mt-28 border-t border-sand pt-12">
        <p
          className={`text-sm tracking-[0.22em] text-ink-soft ${familyClass(locale, "sans")}`}
          lang={htmlLang[locale]}
        >
          {pick(trustStripLabel, locale)}
        </p>
        <p
          className={`mt-4 max-w-3xl text-lg leading-relaxed text-charcoal ${familyClass(locale, "sans")}`}
          lang={htmlLang[locale]}
        >
          {disclosure}
        </p>
      </section>

      {/* WhatsApp enquiry entry (renders nothing without a confirmed number). */}
      <section className="mt-20">
        <p
          className={`text-xl text-charcoal ${familyClass(locale, "display")}`}
          lang={htmlLang[locale]}
        >
          {enquiryIntro}
        </p>
        <div className="mt-6">
          <WhatsAppButton
            number={config.whatsappNumber}
            lang={locale}
            message={buildEnquiryMessage(
              content,
              config.brandName,
              dropSubject,
              locale,
            )}
          />
        </div>
      </section>
    </main>
  );
}

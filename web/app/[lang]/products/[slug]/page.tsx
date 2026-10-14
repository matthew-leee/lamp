/**
 * Product story page: one SKU of the numbered opening drop (Vision.md
 * DROP-01, TRUST-01, TRUST-02).
 *
 * Static generation contract (T1 lesson, web/README.md): every valid path is
 * known at build time from generateStaticParams (the fetched catalogue's
 * slugs x the configured locales) and `dynamicParams = false` rejects
 * anything else at the router, BEFORE this page executes. notFound() is never
 * reached at request time (the guard below is build-time only), because
 * notFound() thrown at request time escapes SSR in this no-root-layout setup
 * and recovers without its lang attribute.
 *
 * Data (DATA-02/CONFIG-01): the SKU, its locale-keyed copy (per-locale
 * columns in Postgres), art configuration
 * and labelled reference price come from the fetched catalogue (Postgres via
 * the Rust API); trust copy (disclosure, warranty pending, reference
 * pending) is company copy from the site_content table rendered with the
 * resolved brand; the price renders in the configured currency.
 *
 * Copy rules (I18N-01, founder decision 2026-10-14): SINGLE-LOCALE DISPLAY.
 * Every passage renders ONLY the chosen locale's text, one passage per key,
 * each with its own lang attribute (WCAG 3.1.2 Language of Parts) and the
 * script-aware type family for that locale. The old paired-equal-weight
 * display (every passage in both languages) is RETIRED.
 *
 * Above the fold: the hero placeholder art with the single signature
 * interaction (lights on / lights off, the only client JS on this page) and
 * the trust block: independent-seller disclosure (TRUST-01), own warranty in
 * honest pending copy (founder open item, never invented terms), labelled
 * reference price with source and checked date or verification pending
 * (TRUST-02), verified electrical facts, the stock badge, the price in big
 * numerals and the drop numbering. The stock badge is a client component
 * (commitment 5b, review finding 1): SSR HTML never contains a stock number,
 * and the badge is the ONLY per-SKU availability claim on the page. There is
 * deliberately no unconditional "in stock" line and no drop-level Hong Kong
 * line here (that fact lives on the homepage hero only, review finding 2),
 * and nothing states a delivery duration (commitment 7). Below: the heritage
 * story and the WhatsApp enquiry.
 *
 * Prices format only through lib/money.ts with the configured currency. No
 * em-dashes in user-facing copy.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { familyClass, isCjkLocale } from "@/components/bilingual";
import LightsToggle from "@/components/lights-toggle";
import StockBadge from "@/components/stock-badge";
import WhatsAppButton from "@/components/whatsapp-button";
import {
  contentValue,
  fetchCatalogue,
  fetchSettings,
  fetchSiteContent,
  getProduct,
  type CatalogueProduct,
  type ReferencePrice,
} from "@/lib/catalog-client";
import {
  renderTemplate,
  requireApiUrl,
  resolveSiteConfig,
} from "@/lib/config";
import { htmlLang, isLocale, locales, type Locale } from "@/lib/i18n";
import { alternatesFor, jsonLdScript, productJsonLd } from "@/lib/seo";
import { formatMoney } from "@/lib/money";
import {
  artLabel,
  backToDrop,
  buildEnquiryMessage,
  disclosureLabel,
  dropNumbering,
  electricalLabel,
  heritageLabel,
  pick,
  priceLabel,
  productDisplay,
  productMetaDescription,
  referenceChecked,
  referenceLabel,
  referenceRange,
  referenceSourceLabel,
  warrantyLabel,
} from "@/lib/ui-copy";

// Unknown slugs 404 from the global shell without executing this page
// (T1 lesson: never call notFound() at request time in this setup).
export const dynamicParams = false;

/** The fetched catalogue's slugs (fail-loud: no API, no product pages). */
export async function generateStaticParams() {
  const catalogue = await fetchCatalogue(requireApiUrl());
  return catalogue.products.map((product) => ({ slug: product.slug }));
}

type ProductPageProps = {
  params: Promise<{ lang: string; slug: string }>;
};

/** One per-locale passage from the product's content rows (fail-loud). */
function productCopy(
  product: CatalogueProduct,
  field: "heritage" | "electrical",
  locale: string,
): string {
  const value = product.content[locale]?.[field];
  if (value === undefined) {
    throw new Error(
      `product page: product "${product.slug}" has no ${field} copy for ` +
        `locale "${locale}" (complete the product_content row or deactivate ` +
        "the SKU).",
    );
  }
  return value;
}

/**
 * Page data: catalogue row + content + resolved config, fetched at build
 * and at every on-demand revalidation. Returns null for an unknown slug.
 */
async function loadProductData(slug: string) {
  const apiUrl = requireApiUrl();
  const [catalogue, content, overrides] = await Promise.all([
    fetchCatalogue(apiUrl),
    fetchSiteContent(apiUrl),
    fetchSettings(apiUrl),
  ]);
  const config = resolveSiteConfig(overrides);
  const product = getProduct(catalogue, slug);
  if (product === undefined) return null;
  return { catalogue, content, config, product };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) {
    notFound();
  }
  const locale: Locale = lang;

  const data = await loadProductData(slug);
  // Unknown slug: at BUILD this is impossible (generateStaticParams emits
  // only catalogue slugs) and the router 40s anything else. At ON-DEMAND
  // REVALIDATION it means a previously generated SKU left the active
  // catalogue (deactivated in the DB): throwing is deliberately NOT
  // notFound() (request-time notFound() escapes SSR in this no-root-layout
  // setup and loses the document language) and NOT a silent half-page — the
  // re-render fails loudly and Next keeps serving the last good page until
  // the D2 admin rebuilds/revalidates with the SKU removed.
  if (data === null) {
    throw new Error(
      `product page: slug "${slug}" is no longer in the active catalogue ` +
        "(deactivated after generation); re-run the build with the current " +
        "catalogue to retire this route.",
    );
  }
  const { catalogue, content, config, product } = data;
  const name = productDisplay(product, locale);
  const reference = product.referencePrice;
  const art = product.art;

  // Trust copy from site content, rendered with the brand in the CHOSEN
  // locale only (DATA-02; single-locale display, founder 2026-10-14).
  const disclosureText = renderTemplate(
    contentValue(content, "trust.disclosure", locale),
    { brand: config.brandName },
  );
  const warrantyText = renderTemplate(
    contentValue(content, "warranty.pending", locale),
    { brand: config.brandName },
  );
  const referencePendingText = contentValue(content, "reference.pending", locale);

  const piecesText = dropNumbering(product.pieces, catalogue.totalPieces, locale);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      {/* Product JSON-LD (T4): name, sku, brand, absolute offer URL, price
          (integer-math string) and currency. Availability is deliberately
          omitted (lib/seo.ts: an unconfirmed stock claim in SSR HTML is
          forbidden by commitment 5b). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // jsonLdScript (lib/seo.ts): admin-writable product text must never
          // be able to terminate this element — `<` is escaped, so a stored
          // `</script>` cannot break out (review finding, D2b task 4).
          __html: jsonLdScript(
            productJsonLd({ product, locale, config }),
          ),
        }}
      />
      <p className={`pt-10 text-sm ${familyClass(locale, "sans")}`}>
        <Link
          href={`/${locale}`}
          className="text-ink-soft underline underline-offset-4 transition-colors duration-200 hover:text-charcoal"
        >
          <span lang={htmlLang[locale]}>{pick(backToDrop, locale)}</span>
        </Link>
      </p>

      {/* Hero + trust block. */}
      <div className="mt-10 grid gap-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-20">
        <div>
          <LightsToggle
            hue={art.hue}
            variant={art.variant}
            label={artLabel(name, locale)}
            lang={locale}
          />
        </div>

        <div>
          <p
            className={`text-xs tracking-[0.18em] text-ink-soft ${familyClass(locale, "sans")}`}
            lang={htmlLang[locale]}
          >
            {piecesText}
          </p>

          <h1
            className={`mt-3 text-3xl leading-snug text-charcoal ${familyClass(locale, "display")}`}
            lang={htmlLang[locale]}
          >
            {name}
          </h1>

          <p className="mt-6 text-5xl tracking-tight text-charcoal font-sans">
            {formatMoney(product.priceCents, config.currency)}
          </p>
          <p
            className={`mt-1 text-xs tracking-[0.18em] text-ink-soft ${familyClass(locale, "sans")}`}
            lang={htmlLang[locale]}
          >
            {pick(priceLabel, locale)}
          </p>

          <div className="mt-4">
            <StockBadge
              slug={product.slug}
              unitsInDrop={product.unitsInDrop}
              lang={locale}
            />
          </div>

          {/* Trust block (TRUST-01, TRUST-02): labelled facts in the chosen
              language (single-locale display, founder 2026-10-14). */}
          <dl className="mt-10 space-y-8 border-t border-sand pt-8">
            <div>
              <dt
                className={`text-sm text-ink-soft ${familyClass(locale, "sans")}`}
                lang={htmlLang[locale]}
              >
                {pick(disclosureLabel, locale)}
              </dt>
              <dd className="mt-2">
                <p
                  lang={htmlLang[locale]}
                  className={`text-sm leading-relaxed text-charcoal ${familyClass(locale, "sans")}`}
                >
                  {disclosureText}
                </p>
              </dd>
            </div>

            <div>
              <dt
                className={`text-sm text-ink-soft ${familyClass(locale, "sans")}`}
                lang={htmlLang[locale]}
              >
                {pick(warrantyLabel, locale)}
              </dt>
              <dd className="mt-2">
                <p
                  lang={htmlLang[locale]}
                  className={`text-sm leading-relaxed text-charcoal ${familyClass(locale, "sans")}`}
                >
                  {warrantyText}
                </p>
              </dd>
            </div>

            <div>
              <dt
                className={`text-sm text-ink-soft ${familyClass(locale, "sans")}`}
                lang={htmlLang[locale]}
              >
                {pick(referenceLabel, locale)}
              </dt>
              <dd className="mt-2">
                {reference === null ? (
                  <p
                    lang={htmlLang[locale]}
                    className={`text-sm leading-relaxed text-charcoal ${familyClass(locale, "sans")}`}
                  >
                    {referencePendingText}
                  </p>
                ) : (
                  <ReferencePriceBlock
                    reference={reference}
                    lang={locale}
                    currency={config.currency}
                  />
                )}
              </dd>
            </div>

            {/* Availability entry removed on purpose (review finding 2): the
                confirmed "N left" badge above is the only per-SKU availability
                claim, and no unconditional "in stock" sentence may contradict
                it. Commitment 7 is kept by saying nothing about delivery. */}

            <div>
              <dt
                className={`text-sm text-ink-soft ${familyClass(locale, "sans")}`}
                lang={htmlLang[locale]}
              >
                {pick(electricalLabel, locale)}
              </dt>
              <dd className="mt-2">
                <p
                  lang={htmlLang[locale]}
                  className={`text-sm leading-relaxed text-charcoal ${familyClass(locale, "sans")}`}
                >
                  {productCopy(product, "electrical", locale)}
                </p>
              </dd>
            </div>
          </dl>

          <div className="mt-10">
            <WhatsAppButton
              number={config.whatsappNumber}
              lang={locale}
              message={buildEnquiryMessage(
                content,
                config.brandName,
                name,
                locale,
              )}
            />
          </div>
        </div>
      </div>

      {/* Below the fold: why the object matters. */}
      <section className="mt-24 border-t border-sand pt-12">
        <p
          className={`text-sm tracking-[0.22em] text-ink-soft ${familyClass(locale, "sans")}`}
          lang={htmlLang[locale]}
        >
          {pick(heritageLabel, locale)}
        </p>
        <p
          lang={htmlLang[locale]}
          className={`mt-6 max-w-3xl text-2xl leading-relaxed text-charcoal ${familyClass(locale, "display")}`}
        >
          {productCopy(product, "heritage", locale)}
        </p>
      </section>
    </main>
  );
}

/**
 * Labelled reference price (TRUST-02) in the CHOSEN locale: the range, the
 * source and the date the source was checked. The source name is an English
 * proper name inside the passage, so it carries its own lang attribute
 * (WCAG 3.1.2 Language of Parts).
 */
function ReferencePriceBlock({
  reference,
  lang,
  currency,
}: {
  reference: ReferencePrice;
  lang: Locale;
  currency: string;
}) {
  return (
    <>
      <p
        lang={htmlLang[lang]}
        className={`text-sm leading-relaxed text-charcoal ${familyClass(lang, "sans")}`}
      >
        {referenceRange(reference, currency, lang)}
      </p>
      <p
        lang={htmlLang[lang]}
        className={`mt-1 text-sm leading-relaxed text-charcoal ${familyClass(lang, "sans")}`}
      >
        {pick(referenceSourceLabel, lang)}
        {/* Script-based separator (same finding class): a CJK page uses the
            full-width colon regardless of which locale is configured first. */}
        {isCjkLocale(lang) ? "：" : ": "}
        {/* The English-source exception is ENGLISH by definition (review
            finding), not "the first configured locale": a zh-HK-first
            deployment must still mark the source name lang="en". */}
        <a
          href={reference.sourceUrl}
          lang="en"
          className="underline underline-offset-4 transition-colors duration-200 hover:text-ink-soft"
        >
          {reference.sourceName}
        </a>
        {lang === locales[0] ? ", " : "，"}
        {referenceChecked(reference, lang)}
      </p>
    </>
  );
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) return {};
  const data = await loadProductData(slug);
  if (data === null) return {};

  const subject = productDisplay(data.product, lang);
  return {
    title: `${subject} | ${data.config.brandName}`,
    description: productMetaDescription(
      data.content,
      data.config.brandName,
      subject,
      lang,
    ),
    // Canonical + hreflang (T4): absolute URLs from the canonical site URL.
    alternates: alternatesFor(data.config, `products/${slug}`, lang),
  };
}

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
 * Data (DATA-02/CONFIG-01): the SKU, its bilingual copy, art configuration
 * and labelled reference price come from the fetched catalogue (Postgres via
 * the Rust API); trust copy (disclosure, warranty pending, reference
 * pending) is company copy from the site_content table rendered with the
 * resolved brand; the price renders in the configured currency.
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

import BilingualPair, { familyClass } from "@/components/bilingual";
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
import { altLocale, htmlLang, isLocale, locales, type Locale } from "@/lib/i18n";
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
  type Bilingual,
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

/** Build a bilingual pair from per-locale product copy. */
function productPair(
  product: CatalogueProduct,
  field: "heritage" | "electrical",
): Bilingual {
  const out: Bilingual = {};
  for (const locale of locales) {
    out[locale] = productCopy(product, field, locale);
  }
  return out;
}

/** Bilingual display name of the SKU. */
function namePair(product: CatalogueProduct): Bilingual {
  const out: Bilingual = {};
  for (const locale of locales) {
    out[locale] = productDisplay(product, locale);
  }
  return out;
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
  const alt = altLocale(locale);

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
  const name = namePair(product);
  const reference = product.referencePrice;
  const art = product.art;

  // Trust copy from site content, rendered with the brand (DATA-02).
  const disclosurePair: Bilingual = {};
  const warrantyPair: Bilingual = {};
  const referencePendingPair: Bilingual = {};
  for (const l of locales) {
    disclosurePair[l] = renderTemplate(
      contentValue(content, "trust.disclosure", l),
      { brand: config.brandName },
    );
    warrantyPair[l] = renderTemplate(
      contentValue(content, "warranty.pending", l),
      { brand: config.brandName },
    );
    referencePendingPair[l] = contentValue(content, "reference.pending", l);
  }

  const piecesPair: Bilingual = {};
  for (const l of locales) {
    piecesPair[l] = dropNumbering(product.pieces, catalogue.totalPieces, l);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      <p className={`pt-10 text-sm ${familyClass(locale, "sans")}`}>
        <Link
          href={`/${locale}`}
          className="text-ink-soft underline underline-offset-4 transition-colors duration-200 hover:text-charcoal"
        >
          <span lang={htmlLang[locale]}>{pick(backToDrop, locale)}</span>
          <span aria-hidden="true" className="px-2">
            /
          </span>
          <span lang={htmlLang[alt]}>{pick(backToDrop, alt)}</span>
        </Link>
      </p>

      {/* Hero + trust block. */}
      <div className="mt-10 grid gap-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-20">
        <div>
          <LightsToggle
            hue={art.hue}
            variant={art.variant}
            label={artLabel(name, locale)}
          />
        </div>

        <div>
          <p
            className={`text-xs tracking-[0.18em] text-ink-soft ${familyClass(locale, "sans")}`}
          >
            <span lang={htmlLang[locale]}>{piecesPair[locale]}</span>
            <span aria-hidden="true" className="px-1.5">
              /
            </span>
            <span lang={htmlLang[alt]}>{piecesPair[alt]}</span>
          </p>

          <h1 className="mt-3 text-3xl leading-snug text-charcoal">
            <span lang={htmlLang[locale]} className={familyClass(locale, "display")}>
              {name[locale]}
            </span>
            <span aria-hidden="true" className="px-2 text-linen">
              /
            </span>
            <span lang={htmlLang[alt]} className={familyClass(alt, "display")}>
              {name[alt]}
            </span>
          </h1>

          <p className="mt-6 text-5xl tracking-tight text-charcoal font-sans">
            {formatMoney(product.priceCents, config.currency)}
          </p>
          <p className={`mt-1 text-xs tracking-[0.18em] text-ink-soft ${familyClass(locale, "sans")}`}>
            <span lang={htmlLang[locale]}>{pick(priceLabel, locale)}</span>
            <span aria-hidden="true" className="px-1.5">
              /
            </span>
            <span lang={htmlLang[alt]}>{pick(priceLabel, alt)}</span>
          </p>

          <div className="mt-4">
            <StockBadge
              slug={product.slug}
              unitsInDrop={product.unitsInDrop}
              lang={locale}
            />
          </div>

          {/* Trust block (TRUST-01, TRUST-02): labelled facts, both languages. */}
          <dl className="mt-10 space-y-8 border-t border-sand pt-8">
            <div>
              <dt className={`text-sm text-ink-soft ${familyClass(locale, "sans")}`}>
                <span lang={htmlLang[locale]}>{pick(disclosureLabel, locale)}</span>
                <span aria-hidden="true" className="px-1.5">
                  /
                </span>
                <span lang={htmlLang[alt]}>{pick(disclosureLabel, alt)}</span>
              </dt>
              <dd className="mt-2">
                <BilingualPair
                  text={disclosurePair}
                  lang={locale}
                  className="text-sm leading-relaxed text-charcoal"
                />
              </dd>
            </div>

            <div>
              <dt className={`text-sm text-ink-soft ${familyClass(locale, "sans")}`}>
                <span lang={htmlLang[locale]}>{pick(warrantyLabel, locale)}</span>
                <span aria-hidden="true" className="px-1.5">
                  /
                </span>
                <span lang={htmlLang[alt]}>{pick(warrantyLabel, alt)}</span>
              </dt>
              <dd className="mt-2">
                <BilingualPair
                  text={warrantyPair}
                  lang={locale}
                  className="text-sm leading-relaxed text-charcoal"
                />
              </dd>
            </div>

            <div>
              <dt className={`text-sm text-ink-soft ${familyClass(locale, "sans")}`}>
                <span lang={htmlLang[locale]}>{pick(referenceLabel, locale)}</span>
                <span aria-hidden="true" className="px-1.5">
                  /
                </span>
                <span lang={htmlLang[alt]}>{pick(referenceLabel, alt)}</span>
              </dt>
              <dd className="mt-2">
                {reference === null ? (
                  <BilingualPair
                    text={referencePendingPair}
                    lang={locale}
                    className="text-sm leading-relaxed text-charcoal"
                  />
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
              <dt className={`text-sm text-ink-soft ${familyClass(locale, "sans")}`}>
                <span lang={htmlLang[locale]}>{pick(electricalLabel, locale)}</span>
                <span aria-hidden="true" className="px-1.5">
                  /
                </span>
                <span lang={htmlLang[alt]}>{pick(electricalLabel, alt)}</span>
              </dt>
              <dd className="mt-2">
                <BilingualPair
                  text={productPair(product, "electrical")}
                  lang={locale}
                  className="text-sm leading-relaxed text-charcoal"
                />
              </dd>
            </div>
          </dl>

          <div className="mt-10">
            <WhatsAppButton
              number={config.whatsappNumber}
              message={buildEnquiryMessage(content, config.brandName, name)}
            />
          </div>
        </div>
      </div>

      {/* Below the fold: why the object matters. */}
      <section className="mt-24 border-t border-sand pt-12">
        <p className={`text-sm tracking-[0.22em] text-ink-soft ${familyClass(locale, "sans")}`}>
          <span lang={htmlLang[locale]}>{pick(heritageLabel, locale)}</span>
          <span aria-hidden="true" className="px-1.5">
            /
          </span>
          <span lang={htmlLang[alt]}>{pick(heritageLabel, alt)}</span>
        </p>
        <BilingualPair
          text={productPair(product, "heritage")}
          lang={locale}
          family="display"
          className="mt-6 max-w-3xl text-2xl leading-relaxed text-charcoal"
        />
      </section>
    </main>
  );
}

/**
 * Labelled reference price (TRUST-02): the range, the source and the date the
 * source was checked. The source name is an English proper name inside both
 * passages, so it carries its own lang attribute (WCAG 3.1.2).
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
  const alt = altLocale(lang);

  return (
    <>
      <BilingualPair
        text={{
          [locales[0]]: referenceRange(reference, currency, locales[0]),
          [locales[1]]: referenceRange(reference, currency, locales[1]),
        }}
        lang={lang}
        className="text-sm leading-relaxed text-charcoal"
      />
      {([lang, alt] as const).map((locale) => (
        <p
          key={locale}
          lang={htmlLang[locale]}
          className={`mt-1 text-sm leading-relaxed text-charcoal ${familyClass(locale, "sans")}`}
        >
          {pick(referenceSourceLabel, locale)}
          {locale === locales[0] ? ": " : "："}
          <a
            href={reference.sourceUrl}
            lang={htmlLang[locales[0]]}
            className="underline underline-offset-4 transition-colors duration-200 hover:text-ink-soft"
          >
            {reference.sourceName}
          </a>
          {locale === locales[0] ? ", " : "，"}
          {referenceChecked(reference, locale)}
        </p>
      ))}
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
  };
}

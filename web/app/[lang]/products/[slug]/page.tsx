/**
 * Product story page: one SKU of the numbered opening drop (Vision.md
 * DROP-01, TRUST-01, TRUST-02).
 *
 * Static generation contract (T1 lesson, web/README.md): every valid path is
 * known at build time from generateStaticParams (8 slugs x 2 locales) and
 * `dynamicParams = false` rejects anything else at the router, BEFORE this
 * page executes. notFound() is never reached at request time (the guard below
 * is build-time only), because notFound() thrown at request time escapes SSR
 * in this no-root-layout setup and recovers without its lang attribute.
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
 * Prices format only through lib/money.ts (formatHKD). No em-dashes in
 * user-facing copy.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import BilingualPair, { familyClass } from "@/components/bilingual";
import LightsToggle from "@/components/lights-toggle";
import StockBadge from "@/components/stock-badge";
import WhatsAppButton from "@/components/whatsapp-button";
import { CATALOG, DROP, getProduct, type ReferencePrice } from "@/lib/catalog";
import { altLocale, htmlLang, isLocale, type Locale } from "@/lib/i18n";
import { formatHKD } from "@/lib/money";
import {
  artLabel,
  backToDrop,
  disclosure,
  disclosureLabel,
  dropNumbering,
  electricalLabel,
  heritageLabel,
  localizedToBilingual,
  pick,
  priceLabel,
  productDescription,
  productDisplay,
  referenceChecked,
  referenceLabel,
  referencePending,
  referenceRange,
  referenceSourceLabel,
  warrantyLabel,
  warrantyPending,
} from "@/lib/ui-copy";

// Unknown slugs 404 from the global shell without executing this page
// (T1 lesson: never call notFound() at request time in this setup).
export const dynamicParams = false;

/** 8 catalogue slugs x 2 locales = 16 static product pages. */
export function generateStaticParams() {
  return CATALOG.map((product) => ({ slug: product.slug }));
}

type ProductPageProps = {
  params: Promise<{ lang: string; slug: string }>;
};

export default async function ProductPage({ params }: ProductPageProps) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) {
    notFound();
  }

  const product = getProduct(slug);
  // Build-time guard only: generateStaticParams + dynamicParams = false mean
  // an unknown slug never reaches this line at request time.
  if (!product) {
    notFound();
  }

  const alt = altLocale(lang);
  const name = productDisplay(product);
  const pieces = dropNumbering(product.dropNumbers, DROP.totalPieces);
  const reference = product.referencePrice;
  const variant = product.slug.startsWith("ph-") ? "shades" : "dome";

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      <p className={`pt-10 text-sm ${familyClass(lang, "sans")}`}>
        <Link
          href={`/${lang}`}
          className="text-ink-soft underline underline-offset-4 transition-colors duration-200 hover:text-charcoal"
        >
          <span lang={htmlLang[lang]}>{backToDrop[lang]}</span>
          <span aria-hidden="true" className="px-2">
            /
          </span>
          <span lang={htmlLang[alt]}>{backToDrop[alt]}</span>
        </Link>
      </p>

      {/* Hero + trust block. */}
      <div className="mt-10 grid gap-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-20">
        <div>
          <LightsToggle
            hue={product.placeholder.hue}
            variant={variant}
            label={pick(artLabel(name), lang)}
          />
        </div>

        <div>
          <p
            className={`text-xs tracking-[0.18em] text-ink-soft ${familyClass(lang, "sans")}`}
          >
            <span lang={htmlLang[lang]}>{pieces[lang]}</span>
            <span aria-hidden="true" className="px-1.5">
              /
            </span>
            <span lang={htmlLang[alt]}>{pieces[alt]}</span>
          </p>

          <h1 className="mt-3 text-3xl leading-snug text-charcoal">
            <span lang={htmlLang[lang]} className={familyClass(lang, "display")}>
              {name[lang]}
            </span>
            <span aria-hidden="true" className="px-2 text-linen">
              /
            </span>
            <span lang={htmlLang[alt]} className={familyClass(alt, "display")}>
              {name[alt]}
            </span>
          </h1>

          <p className={`mt-6 text-5xl tracking-tight text-charcoal font-sans`}>
            {formatHKD(product.priceCents)}
          </p>
          <p className={`mt-1 text-xs tracking-[0.18em] text-ink-soft ${familyClass(lang, "sans")}`}>
            <span lang={htmlLang[lang]}>{priceLabel[lang]}</span>
            <span aria-hidden="true" className="px-1.5">
              /
            </span>
            <span lang={htmlLang[alt]}>{priceLabel[alt]}</span>
          </p>

          <div className="mt-4">
            <StockBadge
              slug={product.slug}
              unitsInDrop={product.units}
              lang={lang}
            />
          </div>

          {/* Trust block (TRUST-01, TRUST-02): labelled facts, both languages. */}
          <dl className="mt-10 space-y-8 border-t border-sand pt-8">
            <div>
              <dt className={`text-sm text-ink-soft ${familyClass(lang, "sans")}`}>
                <span lang={htmlLang[lang]}>{disclosureLabel[lang]}</span>
                <span aria-hidden="true" className="px-1.5">
                  /
                </span>
                <span lang={htmlLang[alt]}>{disclosureLabel[alt]}</span>
              </dt>
              <dd className="mt-2">
                <BilingualPair
                  text={disclosure}
                  lang={lang}
                  className="text-sm leading-relaxed text-charcoal"
                />
              </dd>
            </div>

            <div>
              <dt className={`text-sm text-ink-soft ${familyClass(lang, "sans")}`}>
                <span lang={htmlLang[lang]}>{warrantyLabel[lang]}</span>
                <span aria-hidden="true" className="px-1.5">
                  /
                </span>
                <span lang={htmlLang[alt]}>{warrantyLabel[alt]}</span>
              </dt>
              <dd className="mt-2">
                <BilingualPair
                  text={warrantyPending}
                  lang={lang}
                  className="text-sm leading-relaxed text-charcoal"
                />
              </dd>
            </div>

            <div>
              <dt className={`text-sm text-ink-soft ${familyClass(lang, "sans")}`}>
                <span lang={htmlLang[lang]}>{referenceLabel[lang]}</span>
                <span aria-hidden="true" className="px-1.5">
                  /
                </span>
                <span lang={htmlLang[alt]}>{referenceLabel[alt]}</span>
              </dt>
              <dd className="mt-2">
                {reference === null ? (
                  <BilingualPair
                    text={referencePending}
                    lang={lang}
                    className="text-sm leading-relaxed text-charcoal"
                  />
                ) : (
                  <ReferencePriceBlock reference={reference} lang={lang} />
                )}
              </dd>
            </div>

            {/* Availability entry removed on purpose (review finding 2): the
                confirmed "N left" badge above is the only per-SKU availability
                claim, and no unconditional "in stock" sentence may contradict
                it. Commitment 7 is kept by saying nothing about delivery. */}

            <div>
              <dt className={`text-sm text-ink-soft ${familyClass(lang, "sans")}`}>
                <span lang={htmlLang[lang]}>{electricalLabel[lang]}</span>
                <span aria-hidden="true" className="px-1.5">
                  /
                </span>
                <span lang={htmlLang[alt]}>{electricalLabel[alt]}</span>
              </dt>
              <dd className="mt-2">
                <BilingualPair
                  text={localizedToBilingual(product.electrical)}
                  lang={lang}
                  className="text-sm leading-relaxed text-charcoal"
                />
              </dd>
            </div>
          </dl>

          <div className="mt-10">
            <WhatsAppButton subject={name} />
          </div>
        </div>
      </div>

      {/* Below the fold: why the object matters. */}
      <section className="mt-24 border-t border-sand pt-12">
        <p className={`text-sm tracking-[0.22em] text-ink-soft ${familyClass(lang, "sans")}`}>
          <span lang={htmlLang[lang]}>{heritageLabel[lang]}</span>
          <span aria-hidden="true" className="px-1.5">
            /
          </span>
          <span lang={htmlLang[alt]}>{heritageLabel[alt]}</span>
        </p>
        <BilingualPair
          text={localizedToBilingual(product.heritage)}
          lang={lang}
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
}: {
  reference: ReferencePrice;
  lang: Locale;
}) {
  const alt = altLocale(lang);
  const range = referenceRange(reference);
  const checked = referenceChecked(reference);

  return (
    <>
      <BilingualPair
        text={range}
        lang={lang}
        className="text-sm leading-relaxed text-charcoal"
      />
      {([lang, alt] as const).map((locale) => (
        <p
          key={locale}
          lang={htmlLang[locale]}
          className={`mt-1 text-sm leading-relaxed text-charcoal ${familyClass(locale, "sans")}`}
        >
          {referenceSourceLabel[locale]}
          {locale === "en" ? ": " : "："}
          <a
            href={reference.sourceUrl}
            lang={htmlLang.en}
            className="underline underline-offset-4 transition-colors duration-200 hover:text-ink-soft"
          >
            {reference.source}
          </a>
          {locale === "en" ? ", " : "，"}
          {checked[locale]}
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
  const product = getProduct(slug);
  if (!product) return {};

  const name = productDisplay(product);
  return {
    title: `${pick(name, lang)} | HAVN`,
    description: pick(productDescription(name), lang),
  };
}

/**
 * Editorial homepage (Vision.md BRAND-01, DROP-01).
 *
 * "A lookbook with a shop inside it": one hero lamp, lit, then the numbered
 * opening drop as a spacious gallery, then trust. Not a centred hero over
 * three feature cards (docs/designs/havn-opening-drop.md: generic ecommerce
 * slop is a conversion problem here, not a style preference).
 *
 * Copy rules (I18N-01): Traditional Chinese and English at equal weight, each
 * passage with its own lang attribute (WCAG 3.1.2), shared type class per
 * pair so neither language is the smaller translation. No em-dashes.
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
import { CATALOG, DROP } from "@/lib/catalog";
import { altLocale, htmlLang, isLocale } from "@/lib/i18n";
import { formatHKD } from "@/lib/money";
import {
  artLabel,
  disclosure,
  dropEnquirySubject,
  dropFraming,
  dropNumbering,
  enquiryIntro,
  heroEyebrow,
  heroLead,
  heroLeadPaired,
  piecesHeading,
  pick,
  productDisplay,
  trustStripLabel,
} from "@/lib/ui-copy";

/* Shared type class per pair: both languages at the same size, weight and
   contrast (I18N-01). Asserted by test/routes.test.mjs (paired lead copy). */
const leadClass = "text-4xl leading-[1.35] text-charcoal sm:text-5xl";

/* Collection heading pair (I18N-01): ONE class list shared by both languages,
   so neither can become the smaller, greyer translation. The display family
   is script-aware inside the class itself (globals.css: Fraunces for Latin,
   Noto Serif TC for Han), which lets the two class lists be literally
   identical. Asserted by test/routes.test.mjs. */
const collectionHeadingClass = "text-2xl text-charcoal font-display-pair";

type HomePageProps = {
  params: Promise<{ lang: string }>;
};

export default async function HomePage({ params }: HomePageProps) {
  const { lang } = await params;
  if (!isLocale(lang)) {
    notFound();
  }

  const alt = altLocale(lang);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24 sm:px-10">
      {/* Hero: asymmetric editorial, the lamp lit. */}
      <section className="grid gap-12 pt-16 lg:grid-cols-12 lg:gap-16 lg:pt-24">
        <div className="lg:col-span-7">
          <p
            className={`text-sm tracking-[0.22em] text-ink-soft ${familyClass(lang, "sans")}`}
            lang={htmlLang[lang]}
          >
            {heroEyebrow[lang]}
          </p>
          <h1 className={`mt-6 ${leadClass} ${familyClass(lang, "display")}`} lang={htmlLang[lang]}>
            {heroLead[lang]}
          </h1>
          <p
            className={`mt-6 ${leadClass} ${familyClass(alt, "display")}`}
            lang={htmlLang[alt]}
          >
            {heroLeadPaired[alt]}
          </p>
          <p className={`mt-10 text-lg text-charcoal ${familyClass(lang, "sans")}`}>
            <span lang={htmlLang[lang]}>{dropFraming[lang]}</span>
            <span aria-hidden="true" className="px-2 text-linen">
              /
            </span>
            <span lang={htmlLang[alt]}>{dropFraming[alt]}</span>
          </p>
        </div>

        <div className="lg:col-span-5">
          <PlaceholderArt
            lit
            hue={35}
            variant="dome"
            label={pick(artLabel(dropEnquirySubject), lang)}
          />
        </div>
      </section>

      {/* The numbered drop: 8 SKUs, 16 pieces. */}
      <section className="mt-28">
        {/* Equal-typography collection heading pair (I18N-01): identical
            class list for both languages; spacing lives on the wrapper so the
            classes stay byte-identical. */}
        <div className="space-y-2">
          <h2 className={collectionHeadingClass} lang={htmlLang[lang]}>
            {piecesHeading[lang]}
          </h2>
          <p className={collectionHeadingClass} lang={htmlLang[alt]}>
            {piecesHeading[alt]}
          </p>
        </div>

        <ul className="mt-12 grid gap-x-10 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
          {CATALOG.map((product) => {
            const name = productDisplay(product);
            const pieces = dropNumbering(product.dropNumbers, DROP.totalPieces);
            return (
              <li key={product.slug}>
                <Link
                  href={`/${lang}/products/${product.slug}`}
                  className="group block transition-colors duration-200"
                >
                  <PlaceholderArt
                    lit
                    hue={product.placeholder.hue}
                    variant={product.slug.startsWith("ph-") ? "shades" : "dome"}
                  />
                  <p
                    className={`mt-5 text-xs tracking-[0.18em] text-ink-soft ${familyClass(lang, "sans")}`}
                  >
                    <span lang={htmlLang[lang]}>{pieces[lang]}</span>
                    <span aria-hidden="true" className="px-1.5 text-linen">
                      /
                    </span>
                    <span lang={htmlLang[alt]}>{pieces[alt]}</span>
                  </p>
                  <h3 className="mt-2 text-lg leading-snug text-charcoal">
                    <span lang={htmlLang[lang]} className={familyClass(lang, "sans")}>
                      {name[lang]}
                    </span>
                    <span aria-hidden="true" className="px-2 text-linen">
                      /
                    </span>
                    <span lang={htmlLang[alt]} className={familyClass(alt, "sans")}>
                      {name[alt]}
                    </span>
                  </h3>
                  <p className="mt-3 text-2xl text-charcoal font-sans">
                    {formatHKD(product.priceCents)}
                  </p>
                  <div className="mt-3">
                    <StockBadge
                      slug={product.slug}
                      unitsInDrop={product.units}
                      lang={lang}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Trust strip: who HAVN is, in both languages. */}
      <section className="mt-28 border-t border-sand pt-12">
        <p
          className={`text-sm tracking-[0.22em] text-ink-soft ${familyClass(lang, "sans")}`}
          lang={htmlLang[lang]}
        >
          {trustStripLabel[lang]}
        </p>
        <p
          className={`mt-4 max-w-3xl text-lg leading-relaxed text-charcoal ${familyClass(lang, "sans")}`}
          lang={htmlLang[lang]}
        >
          {disclosure[lang]}
        </p>
        <p
          className={`mt-3 max-w-3xl text-lg leading-relaxed text-charcoal ${familyClass(alt, "sans")}`}
          lang={htmlLang[alt]}
        >
          {disclosure[alt]}
        </p>
      </section>

      {/* WhatsApp enquiry entry (renders nothing without a confirmed number). */}
      <section className="mt-20">
        <p className={`text-xl text-charcoal ${familyClass(lang, "display")}`}>
          <span lang={htmlLang[lang]}>{enquiryIntro[lang]}</span>
          <span aria-hidden="true" className="px-2 text-linen">
            /
          </span>
          <span lang={htmlLang[alt]}>{enquiryIntro[alt]}</span>
        </p>
        <div className="mt-6">
          <WhatsAppButton subject={dropEnquirySubject} />
        </div>
      </section>
    </main>
  );
}

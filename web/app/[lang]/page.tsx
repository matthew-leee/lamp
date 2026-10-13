import Link from "next/link";
import { notFound } from "next/navigation";

import { altLocale, htmlLang, isLocale, type Locale } from "@/lib/i18n";

/*
  Placeholder home page (T1 skeleton). It exists so /en and /zh-HK are real
  static routes from the first build. Copy rules from the design record:
  Traditional Chinese and English at equal weight (no translation toggle),
  no em-dashes in user-facing copy.

  Equal prominence (Vision.md I18N-01): paired bilingual copy shares one
  type-class string per pair, so both languages render at the same size,
  weight and contrast; only the type family follows each passage's script
  (display serif for leads, grotesque for notes). Locale-dependent ordering
  (primary first) may vary, so every passage and language link carries an
  explicit lang attribute (WCAG 3.1.2 Language of Parts).
*/

const copy: Record<
  Locale,
  { lead: string; leadAlt: string; note: string; noteAlt: string }
> = {
  en: {
    lead: "Curated designer homeware, in stock in Hong Kong.",
    leadAlt: "HAVN 精選設計家居，香港現貨。",
    note: "The opening drop: 16 numbered pieces of designer lighting.",
    noteAlt: "首發登場：16 件編號設計燈飾。",
  },
  "zh-HK": {
    lead: "精選設計家居，香港現貨。",
    leadAlt: "HAVN, curated designer homeware, in stock in Hong Kong.",
    note: "首發登場：16 件編號設計燈飾。",
    noteAlt: "The opening drop: 16 numbered pieces of designer lighting.",
  },
};

/* Shared type classes per pair: equal prominence for both languages. */
const leadClass = "text-4xl leading-[1.35] text-charcoal sm:text-5xl";
const noteClass = "text-base text-charcoal";

/* Type family per passage language (fraunces / noto pairings in globals.css). */
const family: Record<Locale, { display: string; sans: string }> = {
  en: { display: "font-display", sans: "font-sans" },
  "zh-HK": { display: "font-display-tc", sans: "font-sans-tc" },
};

type HomePageProps = {
  params: Promise<{ lang: string }>;
};

export default async function HomePage({ params }: HomePageProps) {
  const { lang } = await params;
  if (!isLocale(lang)) {
    notFound();
  }

  const t = copy[lang];
  const alt = altLocale(lang);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-between px-6 py-12 sm:px-10">
      <header className="flex items-baseline justify-between">
        <span className={`text-xl tracking-[0.28em] ${family[lang].sans}`}>
          HAVN
        </span>
        <nav
          aria-label={lang === "zh-HK" ? "語言" : "Language"}
          className={`text-sm text-ink-soft ${family[lang].sans}`}
        >
          <Link
            href="/en"
            lang={htmlLang.en}
            className="transition-colors duration-200 hover:text-charcoal"
          >
            English
          </Link>
          <span aria-hidden="true" className="px-2 text-linen">
            /
          </span>
          <Link
            href="/zh-HK"
            lang={htmlLang["zh-HK"]}
            className="transition-colors duration-200 hover:text-charcoal"
          >
            繁體中文
          </Link>
        </nav>
      </header>

      <section className="max-w-3xl py-24">
        <h1
          className={`${leadClass} ${family[lang].display}`}
          lang={htmlLang[lang]}
        >
          {t.lead}
        </h1>
        <p
          className={`mt-6 ${leadClass} ${family[alt].display}`}
          lang={htmlLang[alt]}
        >
          {t.leadAlt}
        </p>
      </section>

      <footer className="border-t border-sand pt-8">
        <p
          className={`${noteClass} ${family[lang].sans}`}
          lang={htmlLang[lang]}
        >
          {t.note}
        </p>
        <p
          className={`mt-2 ${noteClass} ${family[alt].sans}`}
          lang={htmlLang[alt]}
        >
          {t.noteAlt}
        </p>
      </footer>
    </main>
  );
}

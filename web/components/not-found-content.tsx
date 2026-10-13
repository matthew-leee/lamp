import Link from "next/link";

import { htmlLang, languageNames, locales, type Locale } from "@/lib/i18n";

/*
  Shared bilingual 404 content (I18N-01: both languages at equal weight).

  It renders in three shells:
  1. app/[lang]/not-found.tsx inside app/[lang]/layout.tsx (safety net for
 *   notFound() thrown inside the locale tree; unreachable today because
 *   dynamicParams = false and static params make every valid path known):
 *   the locale layout sets <html lang>, globals.css and the next/font
 *   families are available.
 * 2. app/not-found.tsx, the root not-found boundary (safety net).
 * 3. app/global-not-found.tsx, the bare shell for URLs that match no route
 *   tree at all (e.g. /, /fr).
 *
 * Styling: token classes from app/globals.css (CSS-01 single source), which
 * the bare shell ALSO loads since app/global-not-found.tsx imports
 * globals.css (Q3 experiment verified 2026-10-12: the stylesheet <link> is
 * emitted for the routeless document). The inline hex duplication this
 * component used to carry is deleted. Fonts: next/font variables are
 * injected via className on <html> by the locale layout and do NOT exist in
 * the bare shell, so this component uses only generic stacks (font-serif /
 * default sans), never the brand font classes.
 *
 * Each passage and language link carries an explicit lang attribute
 * (WCAG 3.1.2 Language of Parts). The language switcher accessible name is
 * single-language English with an explicit lang attribute: an accessible
 * name must have one identifiable language, and the bare shell's documented
 * default is English.
 */

/** Props: per-locale body copy with the brand already interpolated. */
export interface NotFoundContentProps {
  /** Brand-rendered body line per locale. */
  body: Record<string, string>;
}

/** The locale-neutral heading pair (chrome, not company copy). */
const headingPair: Record<string, string> = {
  en: "Page not found.",
  "zh-HK": "找不到頁面。",
};

export default function NotFoundContent({ body }: NotFoundContentProps) {
  const bodyFor = (locale: string): string =>
    body[locale] ??
    body[locales[0]] ??
    "This page does not exist.";

  return (
    <main className="flex min-h-dvh w-full max-w-4xl flex-col justify-center bg-bone px-6 py-12 text-charcoal">
      <h1 className="text-4xl font-serif font-normal leading-[1.35]">
        {locales.map((locale: Locale) => (
          <span key={locale} className="block" lang={htmlLang[locale]}>
            {headingPair[locale] ?? headingPair.en}
          </span>
        ))}
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-charcoal">
        {locales.map((locale: Locale) => (
          <span key={locale} className="block" lang={htmlLang[locale]}>
            {bodyFor(locale)}
          </span>
        ))}
      </p>
      <nav
        className="mt-10 flex gap-5 text-base text-charcoal"
        aria-label="Language"
        lang={htmlLang[locales[0]]}
      >
        {locales.map((lang: Locale) => (
          <Link
            key={lang}
            href={`/${lang}`}
            className="underline underline-offset-4 text-charcoal transition-colors duration-200 hover:text-ink-soft"
            lang={htmlLang[lang]}
          >
            {languageNames[lang] ?? lang}
          </Link>
        ))}
      </nav>
    </main>
  );
}
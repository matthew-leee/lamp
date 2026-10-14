import Link from "next/link";

import { GENERIC_404_BODY } from "@/lib/not-found-data";
import { htmlLang, languageNames, locales, type Locale } from "@/lib/i18n";

/*
  Shared 404 content (I18N-01 as re-decided by the founder 2026-10-14: ONE
  language per page — the chosen locale's, or the documented default when no
  route locale exists).

  It renders in three shells:
  1. app/[lang]/not-found.tsx inside app/[lang]/layout.tsx (safety net for
     notFound() thrown inside the locale tree; unreachable today because
     dynamicParams = false and static params make every valid path known):
     the locale layout sets <html lang>, globals.css and the next/font
     families are available.
  2. app/not-found.tsx, the root not-found boundary (safety net).
  3. app/global-not-found.tsx, the bare shell for URLs that match no route
     tree at all (e.g. /, /fr).

  Styling: token classes from app/globals.css (CSS-01 single source), which
  the bare shell ALSO loads since app/global-not-found.tsx imports
  globals.css (Q3 experiment verified 2026-10-12: the stylesheet <link> is
  emitted for the routeless document). The inline hex duplication this
  component used to carry is deleted. Fonts: next/font variables are
  injected via className on <html> by the locale layout and do NOT exist in
  the bare shell, so this component uses only generic stacks (font-serif /
  default sans), never the brand font classes.

  The heading and body render the ONE locale of this shell (the alt locale
  never renders), each passage carrying an explicit lang attribute
  (WCAG 3.1.2 Language of Parts). The language switcher is the one control
  that may show both languages (it is how the visitor chooses): each link is
  its locale's endonym with its lang attribute, and the switcher's
  accessible name is single-language English with an explicit lang attribute
  (an accessible name must have one identifiable language, and the bare
  shell's documented default is English).
*/

/** Props: per-locale body copy with the brand already interpolated. */
export interface NotFoundContentProps {
  /** Brand-rendered body line per locale (the shells pick one locale). */
  body: Record<string, string>;
  /** The locale whose copy this shell renders. */
  lang: Locale;
}

/** The 404 heading per locale (chrome, not company copy). */
const headingBy: Record<string, string> = {
  en: "Page not found.",
  "zh-HK": "找不到頁面。",
};

export default function NotFoundContent({ body, lang }: NotFoundContentProps) {
  // Single-language fallback in the REQUESTED locale (review finding): a
  // missing locale row must never borrow another locale's copy (the loader
  // already fills every locale; this is the defensive component leg) — the
  // generic copy in THIS shell's language, never mixed-language content.
  const bodyText = body[lang] ?? GENERIC_404_BODY[lang] ?? GENERIC_404_BODY.en;

  return (
    <main className="flex min-h-dvh w-full max-w-4xl flex-col justify-center bg-bone px-6 py-12 text-charcoal">
      <h1
        className="text-4xl font-serif font-normal leading-[1.35]"
        lang={htmlLang[lang]}
      >
        {headingBy[lang] ?? headingBy.en}
      </h1>
      <p
        className="mt-6 text-lg leading-relaxed text-charcoal"
        lang={htmlLang[lang]}
      >
        {bodyText}
      </p>
      <nav
        className="mt-10 flex gap-5 text-base text-charcoal"
        aria-label="Language"
        lang={htmlLang[locales[0]]}
      >
        {locales.map((switchLocale: Locale) => (
          <Link
            key={switchLocale}
            href={`/${switchLocale}`}
            className="underline underline-offset-4 text-charcoal transition-colors duration-200 hover:text-ink-soft"
            lang={htmlLang[switchLocale]}
          >
            {languageNames[switchLocale] ?? switchLocale}
          </Link>
        ))}
      </nav>
    </main>
  );
}

/**
 * Shared bilingual 404 content (I18N-01: both languages at equal weight).
 *
 * It renders in three shells:
 * 1. app/[lang]/not-found.tsx inside app/[lang]/layout.tsx (safety net for
 *     notFound() thrown inside the locale tree; unreachable today because
 *     dynamicParams = false and static params make every valid path known):
 *     the locale layout sets <html lang>, globals.css and the next/font
 *     families are available.
 * 2. app/not-found.tsx, the root not-found boundary (safety net).
 * 3. app/global-not-found.tsx, the bare shell for URLs that match no route
 *    tree at all (e.g. /, /fr): Next renders no stylesheet, no globals.css
 *    and no next/font output there.
 *
 * Data split (DATA-02): the body copy and page metadata are company content
 * from the `site_content` table (notFound.body, notFound.title,
 * notFound.description), fetched at build and passed as props, rendered with
 * the resolved brand. The shells own a GENERIC, brand-free fallback for the
 * case where content cannot be fetched, so a 404 never becomes a 500. The
 * "Page not found." heading lines are locale-neutral chrome.
 *
 * Styling is inline with hex values mirroring app/globals.css tokens,
 * because globals.css is not loaded in shell 3 (documented CSS-01 exception:
 * the duplication is deliberate; the tokens file remains the source of truth).
 * Font stacks are generic (serif / sans-serif): naming the next/font families
 * here would silently fall through to system fonts in shell 3. Each passage
 * and link carries an explicit lang attribute (WCAG 3.1.2). The accessible
 * name of the switcher is single-language English (documented bare-shell
 * default). box-sizing: border-box keeps 100dvh + padding from overflowing.
 */

import Link from "next/link";

import { htmlLang, languageNames, locales, type Locale } from "@/lib/i18n";
import { GENERIC_404_BODY } from "@/lib/not-found-data";

/** Props: per-locale body copy with the brand already interpolated. */
export interface NotFoundContentProps {
  /** Brand-rendered body line per locale. */
  body: Record<string, string>;
}

export const style = {
  page: {
    boxSizing: "border-box",
    minHeight: "100dvh",
    margin: "0 auto",
    maxWidth: "64rem",
    padding: "3rem 1.5rem",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    backgroundColor: "#f7f3ec" /* bone */,
    color: "#22201c" /* charcoal */,
    fontFamily: "ui-sans-serif, system-ui, sans-serif" /* generic: see note above */,
  },
  heading: {
    margin: 0,
    fontSize: "2.25rem",
    lineHeight: 1.35,
    fontWeight: 400,
    fontFamily: 'Georgia, "Times New Roman", serif' /* generic serif */,
  },
  line: { display: "block" },
  alt: {
    margin: "1.5rem 0 0",
    fontSize: "1.125rem",
    color: "#22201c" /* charcoal, 14.7:1 on bone */,
  },
  nav: {
    marginTop: "2.5rem",
    display: "flex",
    gap: "1.25rem",
    fontSize: "1rem",
  },
  link: {
    color: "#22201c" /* charcoal, 14.7:1 on bone */,
    textDecoration: "underline",
    textUnderlineOffset: "0.25em",
  },
} as const;

/** The locale-neutral heading pair (chrome, not company copy). */
const headingPair: Record<string, string> = {
  en: "Page not found.",
  "zh-HK": "找不到頁面。",
};

export default function NotFoundContent({ body }: NotFoundContentProps) {
  const bodyFor = (locale: string): string =>
    body[locale] ??
    body[locales[0]] ??
    GENERIC_404_BODY[locale] ??
    "This page does not exist.";

  return (
    <main style={style.page}>
      <h1 style={style.heading}>
        {locales.map((locale: Locale) => (
          <span key={locale} style={style.line} lang={htmlLang[locale]}>
            {headingPair[locale] ?? headingPair.en}
          </span>
        ))}
      </h1>
      <p style={style.alt}>
        {locales.map((locale: Locale) => (
          <span key={locale} style={style.line} lang={htmlLang[locale]}>
            {bodyFor(locale)}
          </span>
        ))}
      </p>
      <nav style={style.nav} aria-label="Language" lang={htmlLang[locales[0]]}>
        {locales.map((lang: Locale) => (
          <Link
            key={lang}
            href={`/${lang}`}
            style={style.link}
            lang={htmlLang[lang]}
          >
            {languageNames[lang] ?? lang}
          </Link>
        ))}
      </nav>
    </main>
  );
}

import Link from "next/link";

import { htmlLang, locales, type Locale } from "@/lib/i18n";

/*
  Shared bilingual 404 content (Vision.md I18N-01: Traditional Chinese and
  English at equal weight).

  It renders in three shells:
  1. app/[lang]/not-found.tsx inside app/[lang]/layout.tsx (safety net for
     notFound() thrown inside the locale tree; unreachable today because
     dynamicParams = false and static params make every valid path known):
     the locale layout sets <html lang>, globals.css and the next/font
     families are available.
  2. app/not-found.tsx, the root not-found boundary (safety net).
  3. app/global-not-found.tsx, the bare shell for URLs that match no route
     tree at all (e.g. /, /fr): Next renders no stylesheet, no globals.css
     and no next/font output there.

  Consequences encoded below:

  - Styling is inline with hex values mirroring app/globals.css tokens,
    because globals.css is not loaded in shell 3.
  - Font stacks are generic (serif / sans-serif). The Fraunces / Noto families
    are loaded by next/font/google only in app/[lang]/layout.tsx; naming them
    here would silently fall through to system fonts anyway in shell 3, so we
    ask for the intended generic class instead and let shell 1 layer the web
    fonts on top via the layout.
  - Each language passage and language link carries an explicit lang
    attribute (WCAG 3.1.2 Language of Parts): "en" and "zh-Hant-HK".
  - The language switcher accessible name is single-language English with an
    explicit lang attribute ("Language", lang="en"): an accessible name must
    have one identifiable language, and the bare shell's documented default
    is English. Per-locale switcher labels live in app/[lang]/page.tsx where
    the locale is known.
  - box-sizing: border-box keeps min-height: 100dvh plus the vertical padding
    from overflowing the viewport (content-box would add 6rem to 100dvh).
*/

export const notFoundMetadata = {
  title: "HAVN | Page not found / 找不到頁面",
  description:
    "Page not found. 找不到頁面。HAVN, curated designer homeware, Hong Kong.",
} as const;

const style = {
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

export default function NotFoundContent() {
  return (
    <main style={style.page}>
      <h1 style={style.heading}>
        <span style={style.line} lang={htmlLang.en}>
          Page not found.
        </span>
        <span style={style.line} lang={htmlLang["zh-HK"]}>
          找不到頁面。
        </span>
      </h1>
      <p style={style.alt}>
        <span style={style.line} lang={htmlLang.en}>
          This page does not exist. The two language editions of HAVN are
          linked below.
        </span>
        <span style={style.line} lang={htmlLang["zh-HK"]}>
          此頁面不存在。以下連結前往 HAVN 兩個語言版本。
        </span>
      </p>
      <nav style={style.nav} aria-label="Language" lang={htmlLang.en}>
        {locales.map((lang: Locale) => (
          <Link
            key={lang}
            href={`/${lang}`}
            style={style.link}
            lang={htmlLang[lang]}
          >
            {lang === "zh-HK" ? "繁體中文" : "English"}
          </Link>
        ))}
      </nav>
    </main>
  );
}

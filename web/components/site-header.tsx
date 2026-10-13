/**
 * Shared site header, rendered on every locale page from app/[lang]/layout.tsx.
 *
 * - HAVN wordmark linking to the current locale home.
 * - Locale-aware nav (Home / 首頁), both languages at equal weight (I18N-01).
 * - Language switcher whose accessible name is localized per locale ("Language"
 *   / "語言"); each language name is its own endonym with a lang attribute
 *   (WCAG 3.1.2 Language of Parts). The switcher links to the two locale home
 *   routes because both language editions are whole routes, not overlays.
 */

import Link from "next/link";

import CurrentPageLink from "./current-page-link";
import { htmlLang, locales, type Locale } from "@/lib/i18n";
import {
  languageLabel,
  languageNames,
  navHome,
  navMainLabel,
  pick,
} from "@/lib/ui-copy";
import { familyClass } from "./bilingual";

interface SiteHeaderProps {
  lang: Locale;
}

export default function SiteHeader({ lang }: SiteHeaderProps) {
  return (
    <header className="border-b border-sand">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-baseline justify-between gap-x-10 gap-y-4 px-6 py-6 sm:px-10">
        <Link
          href={`/${lang}`}
          className={`text-xl tracking-[0.28em] text-charcoal ${familyClass(lang, "sans")}`}
        >
          HAVN
        </Link>

        <div className="flex flex-wrap items-baseline gap-x-10 gap-y-3">
          <nav aria-label={pick(navMainLabel, lang)}>
            {/* aria-current="page" only on the actual home route (review
                finding 5): the header lives in the [lang] layout, which cannot
                know the request path, so a tiny usePathname client wrapper
                decides (components/current-page-link.tsx). */}
            <CurrentPageLink
              href={`/${lang}`}
              className={`text-sm text-charcoal transition-colors duration-200 hover:text-ink-soft ${familyClass(lang, "sans")}`}
            >
              <span lang={htmlLang.en}>{navHome.en}</span>
              <span aria-hidden="true" className="px-2 text-linen">
                /
              </span>
              <span lang={htmlLang["zh-HK"]}>{navHome["zh-HK"]}</span>
            </CurrentPageLink>
          </nav>

          <nav
            aria-label={pick(languageLabel, lang)}
            className={`flex items-baseline gap-3 text-sm text-ink-soft ${familyClass(lang, "sans")}`}
          >
            {/* The switcher's aria-current="true" marks the active language
                of this switcher set (route-independent: every page of the
                locale is an "English"/"繁體中文" page), not the current route. */}
            {locales.map((locale) => (
              <Link
                key={locale}
                href={`/${locale}`}
                lang={htmlLang[locale]}
                aria-current={locale === lang ? "true" : undefined}
                className="transition-colors duration-200 hover:text-charcoal"
              >
                {languageNames[locale]}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}

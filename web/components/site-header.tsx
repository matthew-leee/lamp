/**
 * Shared site header, rendered on every locale page from app/[lang]/layout.tsx.
 *
 * - Wordmark (the brand name, env/settings-supplied per NAME-01 — never a
 *   hardcoded literal) linking to the current locale home. The native-script
 *   brand form shows on the second configured locale when one is configured;
 *   otherwise the Latin name serves both.
 * - Locale-aware nav (Home / 首頁), the CHOSEN locale's label only (I18N-01
 *   as re-decided by the founder 2026-10-14: one language per page; the
 *   paired equal-weight display is retired).
 * - Language switcher whose accessible name is localized per locale; each
 *   language name is its own endonym with a lang attribute (WCAG 3.1.2
 *   Language of Parts). The switcher is the ONE control that may show both
 *   languages (it is how the visitor chooses); it links to the two locale
 *   home routes because both language editions are whole routes, not overlays.
 */

import Link from "next/link";

import CurrentPageLink from "./current-page-link";
import { htmlLang, languageNames, locales, type Locale } from "@/lib/i18n";
import {
  languageLabel,
  navHome,
  navMainLabel,
  pick,
} from "@/lib/ui-copy";
import { familyClass } from "./bilingual";

interface SiteHeaderProps {
  lang: Locale;
  /** Resolved brand name (lib/config.ts; env default, settings override). */
  brandName: string;
  /** Native-script brand form, or null when the brand has none. */
  brandNameNative: string | null;
}

export default function SiteHeader({
  lang,
  brandName,
  brandNameNative,
}: SiteHeaderProps) {
  // The native wordmark serves the second (native-script) locale when the
  // brand has one; the Latin wordmark serves the first and is the fallback.
  const wordmark = brandNameNative !== null && lang === locales[1]
    ? brandNameNative
    : brandName;

  return (
    <header className="border-b border-sand">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-baseline justify-between gap-x-10 gap-y-4 px-6 py-6 sm:px-10">
        <Link
          href={`/${lang}`}
          className={`text-xl tracking-[0.28em] text-charcoal ${familyClass(lang, "sans")}`}
        >
          {wordmark}
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
              <span lang={htmlLang[lang]}>{pick(navHome, lang)}</span>
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

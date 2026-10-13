/**
 * Shared site footer, rendered on every locale page from app/[lang]/layout.tsx.
 *
 * It carries the independent-seller disclosure (TRUST-01) in both languages on
 * every page of the site, says so itself, unprompted, wherever the visitor
 * lands, and never implies authorised-dealer status. The disclosure is company
 * copy from the `site_content` table (DATA-02), fetched at build time and
 * passed here rendered with the resolved brand; the location line likewise
 * comes from site content. Both passages render at equal size and weight with
 * their own lang attributes (I18N-01, WCAG 3.1.2). Trust copy stays charcoal
 * on bone (WCAG AA).
 */

import { htmlLang, locales, type Locale } from "@/lib/i18n";
import { familyClass } from "./bilingual";

interface SiteFooterProps {
  lang: Locale;
  /** Disclosure copy per locale, already rendered with the brand. */
  disclosure: Record<string, string>;
  /** Company location line per locale (site content footer.location). */
  location: Record<string, string>;
  /** Resolved brand name. */
  brandName: string;
}

export default function SiteFooter({
  lang,
  disclosure,
  location,
  brandName,
}: SiteFooterProps) {
  const locationText = location[lang] ?? location[locales[0]] ?? "";

  return (
    <footer className="border-t border-sand bg-ecru">
      <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-10">
        {locales.map((locale) => (
          <p
            key={locale}
            lang={htmlLang[locale]}
            className={`mt-2 max-w-3xl text-sm leading-relaxed text-charcoal ${familyClass(locale, "sans")}`}
            style={locale === locales[0] ? { marginTop: 0 } : undefined}
          >
            {disclosure[locale] ?? disclosure[locales[0]]}
          </p>
        ))}
        {locationText === "" ? null : (
          <p
            className={`mt-8 text-xs tracking-[0.22em] text-ink-soft ${familyClass(lang, "sans")}`}
          >
            {brandName} · {locationText}
          </p>
        )}
      </div>
    </footer>
  );
}

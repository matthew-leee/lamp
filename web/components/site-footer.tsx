/**
 * Shared site footer, rendered on every locale page from app/[lang]/layout.tsx.
 *
 * It carries the independent-seller disclosure (TRUST-01) in the CHOSEN
 * locale on every page of the site (I18N-01 as re-decided by the founder
 * 2026-10-14: one language per page; the paired equal-weight display is
 * retired), says so itself, unprompted, wherever the visitor lands, and
 * never implies authorised-dealer status. The disclosure is company copy
 * from the `site_content` table (DATA-02), fetched at build time and
 * rendered with the resolved brand; the location line likewise comes from
 * site content. The passage keeps its lang attribute (WCAG 3.1.2). Trust
 * copy stays charcoal on bone (WCAG AA).
 */

import { htmlLang, type Locale } from "@/lib/i18n";
import { familyClass } from "./bilingual";

interface SiteFooterProps {
  lang: Locale;
  /** Disclosure copy of the chosen locale, already rendered with the brand. */
  disclosure: string;
  /** Company location line of the chosen locale (site content footer.location). */
  location: string;
  /** Resolved brand name. */
  brandName: string;
}

export default function SiteFooter({
  lang,
  disclosure,
  location,
  brandName,
}: SiteFooterProps) {
  return (
    <footer className="border-t border-sand bg-ecru">
      <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-10">
        <p
          lang={htmlLang[lang]}
          className={`max-w-3xl text-sm leading-relaxed text-charcoal ${familyClass(lang, "sans")}`}
        >
          {disclosure}
        </p>
        {location === "" ? null : (
          <p
            lang={htmlLang[lang]}
            className={`mt-8 text-xs tracking-[0.22em] text-ink-soft ${familyClass(lang, "sans")}`}
          >
            {brandName} · {location}
          </p>
        )}
      </div>
    </footer>
  );
}

/**
 * Shared site footer, rendered on every locale page from app/[lang]/layout.tsx.
 *
 * It carries the independent-seller disclosure (TRUST-01) in both languages on
 * every page of the site: HAVN is never an authorised Louis Poulsen dealer and
 * says so itself, unprompted, wherever the visitor lands. Both passages render
 * at equal size and weight with their own lang attributes (I18N-01, WCAG
 * 3.1.2). Trust copy stays in charcoal on bone (WCAG AA).
 */

import { htmlLang, type Locale } from "@/lib/i18n";
import { disclosure } from "@/lib/ui-copy";
import { familyClass } from "./bilingual";

interface SiteFooterProps {
  lang: Locale;
}

export default function SiteFooter({ lang }: SiteFooterProps) {
  return (
    <footer className="border-t border-sand bg-ecru">
      <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-10">
        <p
          lang={htmlLang.en}
          className={`max-w-3xl text-sm leading-relaxed text-charcoal ${familyClass("en", "sans")}`}
        >
          {disclosure.en}
        </p>
        <p
          lang={htmlLang["zh-HK"]}
          className={`mt-2 max-w-3xl text-sm leading-relaxed text-charcoal ${familyClass("zh-HK", "sans")}`}
        >
          {disclosure["zh-HK"]}
        </p>
        <p
          className={`mt-8 text-xs tracking-[0.22em] text-ink-soft ${familyClass(lang, "sans")}`}
        >
          HAVN · Hong Kong
        </p>
      </div>
    </footer>
  );
}

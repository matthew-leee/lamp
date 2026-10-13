/**
 * Shared bilingual rendering helpers (Vision.md I18N-01: 繁體中文 and English
 * first-class and equal weight everywhere).
 *
 * A `BilingualPair` renders one passage in both languages, locale first, each
 * element carrying its own lang attribute (WCAG 3.1.2 Language of Parts) and
 * the exact same type class, so neither language is ever the smaller, greyer
 * translation. Only the type family follows each passage's script.
 */

import { altLocale, htmlLang, type Locale } from "@/lib/i18n";
import type { Bilingual } from "@/lib/ui-copy";

/**
 * Type family class per passage language (composition in globals.css).
 * Script-aware rather than locale-literal: the Latin pairing (Fraunces /
 * Space Grotesk) serves non-CJK locales, the TC pairing (Noto Serif TC /
 * Noto Sans TC) serves zh* locales, so any configured pair gets the right
 * stack without hardcoding "en".
 */
export function familyClass(locale: Locale, kind: "display" | "sans"): string {
  const script = htmlLang[locale] ?? locale;
  const isCjk = /^(zh|ja|ko)/.test(script);
  if (kind === "display") {
    return isCjk ? "font-display-tc" : "font-display";
  }
  return isCjk ? "font-sans-tc" : "font-sans";
}

interface BilingualPairProps {
  text: Bilingual;
  lang: Locale;
  /** Shared type class for both passages (equal weight). */
  className?: string;
  /** Type family for the passages: display serif or grotesque. */
  family?: "display" | "sans";
  /** Element per passage: block copy or inline copy. */
  as?: "p" | "span";
}

export default function BilingualPair({
  text,
  lang,
  className = "",
  family = "sans",
  as = "p",
}: BilingualPairProps) {
  const alt = altLocale(lang);
  const classes = (locale: Locale): string =>
    `${className} ${familyClass(locale, family)}`.trim();

  if (as === "span") {
    return (
      <>
        <span lang={htmlLang[lang]} className={classes(lang)}>
          {text[lang]}
        </span>
        <span lang={htmlLang[alt]} className={classes(alt)}>
          {text[alt]}
        </span>
      </>
    );
  }

  return (
    <>
      <p lang={htmlLang[lang]} className={classes(lang)}>
        {text[lang]}
      </p>
      <p lang={htmlLang[alt]} className={classes(alt)}>
        {text[alt]}
      </p>
    </>
  );
}

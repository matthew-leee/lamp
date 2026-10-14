/**
 * Shared script-aware type-family helper (Vision.md I18N-01 as re-decided by
 * the founder 2026-10-14: ONE first-class language per page).
 *
 * Every storefront passage renders ONLY the text of the locale the visitor
 * chose; the alt locale never renders (the sole exception is the language
 * switcher control, whose links may name each locale in its own script). The
 * old `BilingualPair` equal-weight paired display is RETIRED. Each rendered
 * passage still carries its own lang attribute (WCAG 3.1.2 Language of
 * Parts), and its type family follows the CHOSEN locale's script via
 * familyClass below.
 */

import { htmlLang, type Locale } from "@/lib/i18n";

/**
 * Type family class per passage language (composition in globals.css).
 * Script-aware rather than locale-literal: the Latin pairing (Fraunces /
 * Space Grotesk) serves non-CJK locales, the TC pairing (Noto Serif TC /
 * Noto Sans TC) serves zh* locales, so any configured pair gets the right
 * stack without hardcoding "en".
 */
export function familyClass(locale: Locale, kind: "display" | "sans"): string {
  const isCjk = isCjkLocale(locale);
  if (kind === "display") {
    return isCjk ? "font-display-tc" : "font-display";
  }
  return isCjk ? "font-sans-tc" : "font-sans";
}

/** True when the locale's document language is CJK (script-aware decisions
 * like punctuation separators must follow the SCRIPT, not the configured
 * order of the locale pair — a zh-HK-first deployment behaves identically). */
export function isCjkLocale(locale: Locale): boolean {
  return /^(zh|ja|ko)/.test(htmlLang[locale] ?? locale);
}

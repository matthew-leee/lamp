"use client";

/*
  The lights on / lights off toggle (docs/designs/havn-opening-drop.md: the
  single signature interaction of the site). This is the only client component
  on product pages; everything else renders on the server.

  - Keyboard accessible by construction: a real <button>.
  - State is exposed with aria-pressed, so the accessible name stays static.
  - The accessible name and the visible label are the CHOSEN locale's text
    only (I18N-01 as re-decided by the founder 2026-10-14: one language per
    page; the old deliberately bilingual name is retired — an accessible
    name must have one identifiable language), with its lang attribute
    (WCAG 3.1.2 Language of Parts).
  - The visual change is CSS transition only (see components/placeholder-art
    .tsx), with a reduced-motion opt-out.
*/

import { useState } from "react";

import PlaceholderArt from "./placeholder-art";
import { htmlLang, type Locale } from "@/lib/i18n";
import { lightsToggleLabel, pick } from "@/lib/ui-copy";

interface LightsToggleProps {
  /** Glow hue of this SKU (`CatalogProduct.placeholder.hue`). */
  hue: number;
  /** Lamp family silhouette for the placeholder art. */
  variant: "dome" | "shades";
  /** Localized accessible name for the artwork. */
  label: string;
  /** Chosen locale (the label renders its text only). */
  lang: Locale;
}

export default function LightsToggle({
  hue,
  variant,
  label,
  lang,
}: LightsToggleProps) {
  const [lit, setLit] = useState(true);

  return (
    <div>
      <PlaceholderArt lit={lit} hue={hue} variant={variant} label={label} />
      <button
        type="button"
        aria-pressed={lit}
        aria-label={pick(lightsToggleLabel, lang)}
        onClick={() => setLit((on) => !on)}
        className="mt-4 border border-charcoal px-5 py-2 text-sm text-charcoal transition-colors duration-200 hover:border-glow hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
      >
        <span lang={htmlLang[lang]}>{pick(lightsToggleLabel, lang)}</span>
      </button>
    </div>
  );
}

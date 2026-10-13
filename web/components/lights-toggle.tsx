"use client";

/*
  The lights on / lights off toggle (docs/designs/havn-opening-drop.md: the
  single signature interaction of the site). This is the only client component
  on product pages; everything else renders on the server.

  - Keyboard accessible by construction: a real <button>.
  - State is exposed with aria-pressed, so the accessible name stays static.
  - The accessible name is deliberately bilingual (task requirement for this
    component); each visible label span also carries its own lang attribute
    (WCAG 3.1.2 Language of Parts).
  - The visual change is CSS transition only (see components/placeholder-art
    .tsx), with a reduced-motion opt-out.
*/

import { useState } from "react";

import PlaceholderArt from "./placeholder-art";
import { htmlLang, locales } from "@/lib/i18n";
import { lightsToggleLabel, pick } from "@/lib/ui-copy";

interface LightsToggleProps {
  /** Glow hue of this SKU (`CatalogProduct.placeholder.hue`). */
  hue: number;
  /** Lamp family silhouette for the placeholder art. */
  variant: "dome" | "shades";
  /** Localized accessible name for the artwork. */
  label: string;
}

export default function LightsToggle({
  hue,
  variant,
  label,
}: LightsToggleProps) {
  const [lit, setLit] = useState(true);

  return (
    <div>
      <PlaceholderArt lit={lit} hue={hue} variant={variant} label={label} />
      <button
        type="button"
        aria-pressed={lit}
        aria-label={`${pick(lightsToggleLabel, locales[0])} · ${pick(
          lightsToggleLabel,
          locales[1],
        )}`}
        onClick={() => setLit((on) => !on)}
        className="mt-4 border border-charcoal px-5 py-2 text-sm text-charcoal transition-colors duration-200 hover:border-glow hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
      >
        <span lang={htmlLang[locales[0]]}>{pick(lightsToggleLabel, locales[0])}</span>
        <span aria-hidden="true" className="px-2 text-linen">
          /
        </span>
        <span lang={htmlLang[locales[1]]}>{pick(lightsToggleLabel, locales[1])}</span>
      </button>
    </div>
  );
}

/**
 * WhatsApp enquiry entry (plain anchor, no client JS).
 *
 * The number and the prefilled enquiry message are RESOLVED CONFIGURATION
 * (ENV-01/CONFIG-01: settings override -> env default), passed by the server
 * page: `number` is the confirmed WhatsApp number and `message` is the
 * enquiry copy rendered with the brand in the CHOSEN locale (single-locale
 * display, founder 2026-10-14). When the number is unset or invalid there is
 * no confirmed contact channel, so this component renders nothing at all: no
 * fake number, no dead button. The href is built and validated by
 * lib/whatsapp.ts.
 */

import { htmlLang, type Locale } from "@/lib/i18n";
import { enquiryButtonLabel, pick } from "@/lib/ui-copy";
import { buildWhatsAppHref } from "@/lib/whatsapp";

interface WhatsAppButtonProps {
  /** Confirmed WhatsApp number (international digits), or null when unset. */
  number: string | null;
  /** Chosen locale (the label renders its text only). */
  lang: Locale;
  /** Fully rendered prefilled message (the chosen locale's enquiry copy). */
  message: string;
}

export default function WhatsAppButton({ number, lang, message }: WhatsAppButtonProps) {
  const href = buildWhatsAppHref(number ?? undefined, message);
  if (href === null) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-baseline gap-3 border border-charcoal bg-charcoal px-6 py-3 text-sm text-bone transition-colors duration-200 hover:border-glow hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
    >
      <span lang={htmlLang[lang]}>{pick(enquiryButtonLabel, lang)}</span>
    </a>
  );
}

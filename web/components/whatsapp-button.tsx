/**
 * WhatsApp enquiry entry (plain anchor, no client JS).
 *
 * The number and the prefilled bilingual message are RESOLVED CONFIGURATION
 * (ENV-01/CONFIG-01: settings override -> env default), passed by the server
 * page: `number` is the confirmed WhatsApp number and `message` is the
 * enquiry copy rendered with the brand. When the number is unset or invalid
 * there is no confirmed contact channel, so this component renders nothing at
 * all: no fake number, no dead button. The href is built and validated by
 * lib/whatsapp.ts.
 */

import { htmlLang, locales } from "@/lib/i18n";
import { enquiryButtonLabel, pick } from "@/lib/ui-copy";
import { buildWhatsAppHref } from "@/lib/whatsapp";

interface WhatsAppButtonProps {
  /** Confirmed WhatsApp number (international digits), or null when unset. */
  number: string | null;
  /** Fully rendered prefilled message (both languages, one enquiry). */
  message: string;
}

export default function WhatsAppButton({ number, message }: WhatsAppButtonProps) {
  const href = buildWhatsAppHref(number ?? undefined, message);
  if (href === null) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-baseline gap-3 border border-charcoal bg-charcoal px-6 py-3 text-sm text-bone transition-colors duration-200 hover:border-glow hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
    >
      <span lang={htmlLang[locales[0]]}>
        {pick(enquiryButtonLabel, locales[0])}
      </span>
      <span aria-hidden="true" className="text-linen">
        /
      </span>
      <span lang={htmlLang[locales[1]]}>
        {pick(enquiryButtonLabel, locales[1])}
      </span>
    </a>
  );
}

/**
 * WhatsApp enquiry entry (plain anchor, no client JS).
 *
 * The href is built by lib/whatsapp.ts from NEXT_PUBLIC_WHATSAPP_NUMBER with a
 * prefilled bilingual message naming the subject (a product or the drop). When
 * the number is unset or blank there is no confirmed contact channel, so this
 * component renders nothing at all: no fake number, no dead button.
 */

import { htmlLang } from "@/lib/i18n";
import {
  enquiryButtonLabel,
  enquiryMessage,
  type Bilingual,
} from "@/lib/ui-copy";
import { buildWhatsAppHref } from "@/lib/whatsapp";

interface WhatsAppButtonProps {
  /** What the enquiry is about; named in both languages in the prefilled text. */
  subject: Bilingual;
}

export default function WhatsAppButton({ subject }: WhatsAppButtonProps) {
  const href = buildWhatsAppHref(
    process.env.NEXT_PUBLIC_WHATSAPP_NUMBER,
    enquiryMessage(subject),
  );
  if (href === null) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-baseline gap-3 border border-charcoal bg-charcoal px-6 py-3 text-sm text-bone transition-colors duration-200 hover:border-glow hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
    >
      <span lang={htmlLang.en}>{enquiryButtonLabel.en}</span>
      <span aria-hidden="true" className="text-linen">
        /
      </span>
      <span lang={htmlLang["zh-HK"]}>{enquiryButtonLabel["zh-HK"]}</span>
    </a>
  );
}

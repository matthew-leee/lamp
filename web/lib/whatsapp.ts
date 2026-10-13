/**
 * WhatsApp enquiry link builder (pure).
 *
 * The contact number comes from NEXT_PUBLIC_WHATSAPP_NUMBER (international
 * digits only, see .env.example). When it is unset or blank there is no
 * confirmed number to publish, so the enquiry entry renders nothing at all
 * (components/whatsapp-button.tsx): a fake or placeholder number would be a
 * fabricated contact channel, exactly like a fabricated stock count.
 *
 * Kept out of the .tsx file so it is unit-testable without a JSX transform
 * (test/whatsapp.test.mjs).
 */

/** wa.me accepts a bare international number: 7 to 15 digits, no separators. */
const WHATSAPP_NUMBER = /^[0-9]{7,15}$/;

/**
 * Build a wa.me enquiry link with a prefilled message.
 *
 * @returns the href, or `null` when the number is missing, blank or not a
 *   plausible international number. Never returns a link with a made-up number.
 */
export function buildWhatsAppHref(
  number: string | undefined,
  message: string,
): string | null {
  const trimmed = (number ?? "").trim();
  if (!WHATSAPP_NUMBER.test(trimmed)) return null;
  return `https://wa.me/${trimmed}?text=${encodeURIComponent(message)}`;
}

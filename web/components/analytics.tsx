/**
 * GA4 + Search Console wiring (T4, GA-OFF-01).
 *
 * GA is env/settings-supplied and OFF BY DEFAULT: `gaMeasurementId` null
 * (unset, or shape-invalid — see lib/config.ts validGaId) renders NOTHING
 * (no script tag, no network request). The C8 privacy check gates turning it
 * on at launch, not this code.
 *
 * GSC verification is a meta tag, rendered by generateMetadata in the locale
 * layout (verification.google) only when a token is configured.
 */

import Script from "next/script";

interface AnalyticsScriptsProps {
  /** Resolved GA4 measurement ID (G-XXXX), or null when GA is off. */
  gaMeasurementId: string | null;
}

/** The GA4 gtag.js loader + config, rendered only when an ID is configured. */
export default function AnalyticsScripts({
  gaMeasurementId,
}: AnalyticsScriptsProps) {
  if (gaMeasurementId === null) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag("js", new Date());
gtag("config", "${gaMeasurementId}");`}
      </Script>
    </>
  );
}
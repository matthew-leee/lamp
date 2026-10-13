import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  Fraunces,
  Noto_Sans_TC,
  Noto_Serif_TC,
  Space_Grotesk,
} from "next/font/google";

import AvailabilityProvider from "@/components/availability-context";
import { htmlLang, isLocale, locales } from "@/lib/i18n";
import SiteFooter from "@/components/site-footer";
import SiteHeader from "@/components/site-header";
import "../globals.css";

/*
  Type pairing (docs/designs/havn-opening-drop.md): display serif plus
  grotesque for Latin, Noto Serif TC plus Noto Sans TC for Chinese. All four
  are variable fonts exposed as CSS variables and composed in globals.css.
*/
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const notoSerifTC = Noto_Serif_TC({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-serif-tc",
});

const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-sans-tc",
});

// Locale routing: /en and /zh-HK are generated at build time. Any other
// locale or path is a 404. No middleware by design (T1 decision).
export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

type RootLayoutProps = {
  children: ReactNode;
  params: Promise<{ lang: string }>;
};

export default async function RootLayout({
  children,
  params,
}: RootLayoutProps) {
  const { lang } = await params;
  if (!isLocale(lang)) {
    notFound();
  }

  return (
    <html
      lang={htmlLang[lang]}
      className={[
        fraunces.variable,
        spaceGrotesk.variable,
        notoSerifTC.variable,
        notoSansTC.variable,
      ].join(" ")}
    >
      <body className="min-h-dvh bg-bone font-sans text-charcoal antialiased">
        {/* Shared chrome (T3): every page carries the header and the footer
            disclosure in both languages (TRUST-01). */}
        <SiteHeader lang={lang} />
        {/* Live availability provider (commitment 5b): SSR HTML never carries
            stock numbers; badges confirm them client-side via /api/availability.
            Kept inside the header/footer so the shared chrome stays static. */}
        <AvailabilityProvider>{children}</AvailabilityProvider>
        <SiteFooter lang={lang} />
      </body>
    </html>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  // Metadata is neutral (review finding 2): it may state the drop-level fact
  // that the whole opening drop is physically in Hong Kong, never that a SKU
  // is "in stock" (the confirmed stock badge alone may say that).
  const title =
    lang === "zh-HK"
      ? "HAVN | 精選設計家居 · 首發登場"
      : "HAVN | Curated designer homeware, the opening drop";
  const description =
    lang === "zh-HK"
      ? "HAVN 精選設計家居。設計燈飾首發登場，16 件編號作品，整批俱在香港。"
      : "HAVN, curated designer homeware. The opening drop of designer lighting: 16 numbered pieces, the whole drop physically in Hong Kong.";

  return {
    title,
    description,
  };
}

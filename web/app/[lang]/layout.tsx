import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  Fraunces,
  Noto_Sans_TC,
  Noto_Serif_TC,
  Space_Grotesk,
} from "next/font/google";

import { htmlLang, isLocale, locales } from "@/lib/i18n";
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
        {children}
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
  const title =
    lang === "zh-HK"
      ? "HAVN | 精選設計家居 · 香港現貨"
      : "HAVN | Curated designer homeware, in Hong Kong";
  const description =
    lang === "zh-HK"
      ? "HAVN 精選設計家居。設計燈飾首發登場，16 件編號作品，香港現貨。"
      : "HAVN, curated designer homeware. The opening drop of designer lighting: 16 numbered pieces, in stock in Hong Kong.";

  return {
    title,
    description,
  };
}

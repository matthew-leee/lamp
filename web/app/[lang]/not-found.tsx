import type { Metadata } from "next";

import NotFoundContent from "@/components/not-found-content";
import { loadNotFoundData } from "@/lib/not-found-data";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n";

/*
  Locale-scoped not-found boundary: safety net for notFound() thrown inside
  the locale tree. Unreachable today: dynamicParams = false plus static
  generation mean every valid path is known, and unmatched paths (including
  /en/nope, /zh-HK/nope) never enter this tree; they are served by
  app/global-not-found.tsx. A request-time catch-all was removed because
  notFound() thrown during SSR escapes the locale layout in this
  no-root-layout setup and the recovered document loses its lang attribute.

  Copy comes from the database via lib/not-found-data.ts (fail-soft generic
  fallback); see components/not-found-content.tsx for the shell notes.
*/

type NotFoundProps = {
  params: Promise<{ lang: string }> | undefined;
};

/**
 * The boundary's route locale, or the documented default when Next renders
 * this shell WITHOUT route params (static generation of the not-found
 * boundary passes no props at all — verified: `await params` is undefined
 * there and destructuring it crashes the build).
 */
async function boundaryLocale(
  params: NotFoundProps["params"],
): Promise<Locale> {
  const resolved = await params;
  return resolved !== undefined && isLocale(resolved.lang)
    ? resolved.lang
    : defaultLocale;
}

export async function generateMetadata({
  params,
}: NotFoundProps): Promise<Metadata> {
  const locale = await boundaryLocale(params);
  const data = await loadNotFoundData();
  return {
    title: data.title[locale] ?? data.title[defaultLocale],
    description: data.description[locale] ?? undefined,
  };
}

export default async function NotFound({ params }: NotFoundProps) {
  const locale = await boundaryLocale(params);
  const data = await loadNotFoundData();
  return <NotFoundContent body={data.body} lang={locale} />;
}

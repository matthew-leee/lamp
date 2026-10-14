import type { Metadata } from "next";

import NotFoundContent from "@/components/not-found-content";
import { loadNotFoundData } from "@/lib/not-found-data";
import { defaultLocale } from "@/lib/i18n";

/*
  Root not-found boundary (safety net for notFound() thrown at the root
  layer). Content is shared with app/[lang]/not-found.tsx and
  app/global-not-found.tsx; see components/not-found-content.tsx for why it
  styles itself inline with generic font stacks, and lib/not-found-data.ts
  for the fail-soft data contract (company copy from the database; generic
  brand-free fallback if it cannot be fetched).

  URLs that match no route tree at all (e.g. /, /fr) are served by
  app/global-not-found.tsx instead, which owns the bare <html>/<body> shell
  so the document still declares its language.
*/

export async function generateMetadata(): Promise<Metadata> {
  const data = await loadNotFoundData();
  return {
    title: data.title[defaultLocale] ?? "Page not found / 找不到頁面",
    description: data.description[defaultLocale] ?? undefined,
  };
}

export default async function NotFound() {
  const data = await loadNotFoundData();
  return <NotFoundContent body={data.body} lang={defaultLocale} />;
}

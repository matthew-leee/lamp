import NotFoundContent from "@/components/not-found-content";
import { defaultLocale, htmlLang } from "@/lib/i18n";
import { loadNotFoundData } from "@/lib/not-found-data";

/* Q3 (founder 2026-10-12): globals.css IS imported by this shell, so the
   bare document loads the token stylesheet (verified 2026-10-12: the
   stylesheet <link> is emitted routeless; the component styles from token
   classes). No inline hex. */
import "./globals.css";

/*
  Bare-shell 404 (Next 15 `experimental.globalNotFound` convention, see
  next.config.ts). It serves URLs that match no route tree at all (e.g. /,
  /fr) and is the only place that can set <html lang> for them in this
  no-middleware, no-root-layout setup: Next renders this component as the
  entire document (no layout wraps it). Documented default language: the
  first configured locale (lib/i18n.ts defaultLocale).

  Copy is company content from the database (notFound.* keys) of the
  documented default locale, fetched at build and rendered with the brand;
  if that fails, the generic brand-free fallback renders instead
  (lib/not-found-data.ts never throws). Single-locale display like every
  page (founder 2026-10-14): this shell renders the default locale's copy
  only; the language switcher below it is the control for choosing.
*/

export default async function GlobalNotFound() {
  const data = await loadNotFoundData();

  return (
    <html lang={htmlLang[defaultLocale]}>
      <head>
        <title>{data.title[defaultLocale] ?? "Page not found / 找不到頁面"}</title>
        <meta name="description" content={data.description[defaultLocale] ?? ""} />
      </head>
      <body>
        <NotFoundContent body={data.body} lang={defaultLocale} />
      </body>
    </html>
  );
}
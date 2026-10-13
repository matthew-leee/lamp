import NotFoundContent from "@/components/not-found-content";
import { defaultLocale, htmlLang } from "@/lib/i18n";
import { loadNotFoundData } from "@/lib/not-found-data";

/*
  Bare-shell 404 (Next 15 `experimental.globalNotFound` convention, see
  next.config.ts). It serves URLs that match no route tree at all (e.g. /,
  /fr) and is the only place that can set <html lang> for them in this
  no-middleware, no-root-layout setup: Next renders this component as the
  entire document (no layout wraps it), which is also why it owns the
  <body> reset (margin 0, bone background) that app/globals.css cannot
  provide here. Documented default language: the first configured locale
  (lib/i18n.ts defaultLocale).

  Copy is company content from the database (notFound.* keys), fetched at
  build and rendered with the brand; if that fails, the generic brand-free
  fallback renders instead (lib/not-found-data.ts never throws).
*/

export default async function GlobalNotFound() {
  const data = await loadNotFoundData();

  return (
    <html lang={htmlLang[defaultLocale]}>
      <head>
        <title>{data.title[defaultLocale] ?? "Page not found / 找不到頁面"}</title>
        <meta name="description" content={data.description[defaultLocale] ?? ""} />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          backgroundColor: "#f7f3ec" /* bone */,
        }}
      >
        <NotFoundContent body={data.body} />
      </body>
    </html>
  );
}

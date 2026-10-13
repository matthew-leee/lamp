import NotFoundContent, {
  notFoundMetadata,
} from "@/components/not-found-content";
import { defaultLocale, htmlLang } from "@/lib/i18n";

/*
  Bare-shell 404 (Next 15 `experimental.globalNotFound` convention, see
  next.config.ts). It serves URLs that match no route tree at all (e.g. /,
  /fr) and is the only place that can set <html lang> for them in this
  no-middleware, no-root-layout setup: Next renders this component as the
  entire document (no layout wraps it), which is also why it owns the
  <body> reset (margin 0, bone background) that app/globals.css cannot
  provide here. Documented default language: 'en' (lib/i18n.ts
  defaultLocale). Bilingual content at equal weight (Vision.md I18N-01).
*/

export default function GlobalNotFound() {
  return (
    <html lang={htmlLang[defaultLocale]}>
      <head>
        <title>{notFoundMetadata.title}</title>
        <meta name="description" content={notFoundMetadata.description} />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          backgroundColor: "#f7f3ec" /* bone */,
        }}
      >
        <NotFoundContent />
      </body>
    </html>
  );
}

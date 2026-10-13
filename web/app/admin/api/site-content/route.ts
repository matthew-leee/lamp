import { relayRedirect, sameOriginGuard } from "../../../../lib/admin-relay.ts";
import {
  dispatchDeleteSiteContent,
  dispatchUpsertSiteContent,
} from "../../../../lib/admin-editors.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../lib/admin-session.ts";

/*
  Site-content relay (D2b task 4, ADMIN-01): the plain-HTML-form target of
  the per-key/per-locale copy forms on /admin/site-content — one form per
  (key, locale) row; `action=save` upserts the value, `action=delete`
  removes the row. Same relay architecture as the settings relay
  (lib/admin-client.ts): `dispatchUpsertSiteContent` /
  `dispatchDeleteSiteContent` -> `adminMutate` forwards the session cookie
  AND the X-Requested-With CSRF header; `requireAdminSession`
  (whoami-gated) confirms the session first. The API re-validates
  everything (key non-empty and NUL-free — there is NO key whitelist, keys
  are free-form admin text; locale in the configured pair; value
  NON-empty). DELETE 404 maps to `notfound` (the row may have changed
  underneath the operator).

  Result -> 303 with a RELATIVE Location carrying a slug-only query on the
  page that owns the forms (`/admin/site-content?saved=<key> (<locale>)` /
  `?error=...`). Raw API error text never enters a URL; session values are
  never logged. Keys are free text, so the dispatcher's savedKey is
  URL-encoded whole.

  NO PRE-JUDGEMENT (unlike product-content): the locale is NOT gated on
  DEFAULT_SITE_CONTENT_LOCALES here — the page renders the union of the
  default pair and the locales present in the content map, because the
  deployment's LOCALES pair replaces the default (lib/admin-editors.ts
  note). The API is the judge of the configured pair; the relay passes
  key/locale/value through untouched (a blank value or locale reaches the
  API and 400s honestly -> `invalid`).

  CSRF (web leg): `sameOriginGuard` rejects cross-site browser form POSTs
  (documented limitations in lib/admin-relay.ts); no `Origin` passes.

  A missing/unknown `action` falls back to "save" (the non-destructive
  default, mirroring the settings relay; the browser's implicit submission
  clicks the first submit button — Save — anyway).
*/

/** Served per request: this route mutates admin state, never cache it. */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const guarded = sameOriginGuard(request);
  if (guarded !== null) return guarded;

  // Confirm the session BEFORE reading the form (whoami; redirects when
  // missing/expired). The raw value is then only used to forward.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  const form = (await request.formData().catch(() => null)) ?? new FormData();
  const rawKey = form.get("key");
  const rawLocale = form.get("locale");
  const rawValue = form.get("value");
  const key = typeof rawKey === "string" ? rawKey : "";
  const locale = typeof rawLocale === "string" ? rawLocale : "";
  const value = typeof rawValue === "string" ? rawValue : "";

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  const result =
    form.get("action") === "delete"
      ? await dispatchDeleteSiteContent(apiUrl, key, locale, sessionValue)
      : await dispatchUpsertSiteContent(
          apiUrl,
          { key, locale, value },
          sessionValue,
        );
  const { slug, savedKey } = result;

  if (slug === "saved") {
    return relayRedirect(
      `/admin/site-content?saved=${encodeURIComponent(savedKey ?? `${key} (${locale})`)}`,
    );
  }
  return relayRedirect(`/admin/site-content?error=${slug}`);
}

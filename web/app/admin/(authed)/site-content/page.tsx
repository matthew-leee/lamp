import type { Metadata } from "next";
import Link from "next/link";

import {
  DEFAULT_SITE_CONTENT_LOCALES,
  parseSiteContentMap,
} from "../../../../lib/admin-editors.ts";
import { adminGet } from "../../../../lib/admin-client.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../lib/admin-session.ts";

/*
  Admin site-content page (D2b task 4, ADMIN-01): the site copy editor, one
  form per (key, locale) row. Plain HTML forms with NO client JS;
  ENGLISH-ONLY admin (app/admin/layout.tsx); `globals.css` token classes
  only (CSS-01 — no inline styles, no hex).

  READ: PUBLIC `GET /api/site-content` (plain fetch, `cache: "no-store"` —
  this is a force-dynamic server component) -> `parseSiteContentMap`
  (round-A, strict all-or-nothing). Anything but a 200 with a fully valid
  map renders a fail-loud error panel and NO forms — never render invented
  state. (There is NO admin read for site content in D2a; the public read
  is the only read surface, and it serves exactly the rows the editor
  shows.)

  Locales rendered = UNION of DEFAULT_SITE_CONTENT_LOCALES and the locales
  present in the map: the default pair is the documented fallback, never a
  hard gate (the deployment's LOCALES pair replaces it — see the round-A
  constant). Keys render in map order. The map's own rows are what decide
  "row exists" (the Delete button appears only for a row that is there).

  WRITES go through the relay `app/admin/api/site-content`: `action=save`
  upserts the value, `action=delete` removes the row (404 "not found" if it
  is already gone — the API's honest verdict, shown as the notfound
  banner). The relay answers 303 with a slug-only query on THIS page:
  `?saved=<key> (<locale>)` / `?error=<slug>`. Raw API error text never
  enters a URL. `?saved=` is echoed only when it matches the CLOSED pattern
  of savedKeys the round-A site-content dispatcher produces (a printable
  non-empty key + a locale tag); anything else is ignored — an untrusted
  query string is never rendered. `?error=` maps through a Map with a
  generic fallback.

  `export const dynamic = "force-dynamic"` (admin views show CURRENT DB
  state, never cached) and searchParams is a Promise in Next 15.
*/

export const metadata: Metadata = { title: "Site content" };

/** Served per request: admin state is live DB state, never cache it. */
export const dynamic = "force-dynamic";

/** Slug -> operator-facing message (exact strings, safe to render). */
const errorMessages = new Map<string, string>([
  ["invalid", "Invalid value — not saved. Check the field hints."],
  ["notauthenticated", "Session expired — sign in again."],
  [
    "notfound",
    "Not found — the row may have changed underneath you; reload.",
  ],
  ["conflict", "Already exists (duplicate slug or piece number)."],
  [
    "network",
    "The admin API is unreachable or rejected the change — retry later.",
  ],
]);

/**
 * Closed allowlist pattern for `?saved=`: the savedKeys the round-A
 * site-content dispatchers produce — `<key> (<locale>)`. Keys are
 * admin-free-text, so the KEY side admits any printable non-empty string
 * (bounded); the locale side is a closed BCP-47 shape. Only a key the
 * dispatcher chose is ever echoed; raw searchParams are never rendered.
 */
const savedKeyPattern =
  /^[^\x00-\x1f\x7f]{1,200} \([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\)$/;

/** The shared text-control classes (mirrors the settings page). */
const inputClasses =
  "border border-sand bg-bone px-3 py-2 text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow";

/** The shared Save-button classes (mirrors the settings page). */
const saveButtonClasses =
  "border border-charcoal px-5 py-2 text-sm text-charcoal transition-colors duration-200 hover:border-glow hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow";

interface AdminSiteContentPageProps {
  searchParams: Promise<{ saved?: string; error?: string }>;
}

export default async function AdminSiteContentPage({
  searchParams,
}: AdminSiteContentPageProps) {
  // Session gate (whoami-confirmed; redirects when missing/expired). The
  // read below is PUBLIC but admin-scoped display, so no cookie forwarding.
  await requireAdminSession();

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  // Read through adminGet (review finding): the shared abort budget
  // (headers AND body) + the never-throws {status, json} contract — a
  // stalled API reaches the fail-loud panel at the configured timeout
  // instead of hanging the render. The endpoint is public, but the cookie
  // forwarding is harmless and the read is admin-scoped plumbing.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  const read = await adminGet(apiUrl, "/api/site-content", sessionValue);
  const content =
    read.status === 200 ? parseSiteContentMap(read.json) : null;

  const { saved, error } = await searchParams;
  const savedMessage =
    saved !== undefined && savedKeyPattern.test(saved)
      ? `Saved ${saved} — the storefront's 60-second content lease expires; the next request serves the last-good value while the fresh one regenerates in the background.`
      : null;
  const errorMessage =
    error === undefined ? null : (errorMessages.get(error) ?? "Nothing saved.");

  if (content === null) {
    // Fail loud, render NOTHING else: forms over unknown state are lies.
    return (
      <section className="flex flex-col gap-4">
        <h1 className="font-serif text-2xl font-normal">Site content</h1>
        <p
          role="alert"
          className="border-l-4 border-glow-ember pl-4 text-lg leading-relaxed text-charcoal"
        >
          Site content could not be loaded from the API — retry later.
        </p>
        <Link href="/admin" className="text-sm text-ink-soft underline">
          ← Back to admin
        </Link>
      </section>
    );
  }

  const keys = Object.keys(content);
  // Locale tabs: the default pair UNION whatever rows exist (the deployed
  // LOCALES pair replaces the default — see the round-A constant's note).
  const locales: string[] = [...DEFAULT_SITE_CONTENT_LOCALES];
  for (const entry of Object.values(content)) {
    for (const locale of Object.keys(entry)) {
      if (!locales.includes(locale)) locales.push(locale);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-normal">Site content</h1>
        <p className="text-base leading-relaxed text-ink-soft">
          Site copy per key and locale. Keys are free-form (the server
          applies NO key whitelist) and a value must be NON-empty — a blank
          save is rejected (there is no clearing: deleting a row below
          removes it and the API answers not-found if it is already gone).
        </p>
      </div>

      {savedMessage !== null && (
        <p
          role="status"
          className="border-l-4 border-glow pl-4 text-lg leading-relaxed text-charcoal"
        >
          {savedMessage}
        </p>
      )}

      {errorMessage !== null && (
        <p
          role="alert"
          className="border-l-4 border-glow-ember pl-4 text-lg leading-relaxed text-charcoal"
        >
          {errorMessage}
        </p>
      )}

      {keys.length === 0 && (
        <p className="text-base leading-relaxed text-ink-soft">
          No site content rows yet.
        </p>
      )}

      {keys.map((key) => (
        <div key={key} className="flex flex-col gap-3 border-t border-sand pt-6">
          <h2 className="font-serif text-xl font-normal">
            <code>{key}</code>
          </h2>
          {locales.map((locale) => {
            const value = content[key]?.[locale];
            const exists = typeof value === "string";
            const inputId = `site-${key}-${locale}`;
            return (
              <form
                key={locale}
                method="post"
                action="/admin/api/site-content"
                className="flex max-w-xl flex-col gap-1"
              >
                <label htmlFor={inputId} className="text-base text-charcoal">
                  Locale {locale}
                </label>
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="locale" value={locale} />
                <textarea
                  id={inputId}
                  name="value"
                  rows={3}
                  defaultValue={exists ? value : ""}
                  className={inputClasses}
                />
                <p className="text-sm text-ink-soft">
                  {exists
                    ? "Row exists — saving updates it."
                    : "No row yet — saving creates it."}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    name="action"
                    value="save"
                    className={saveButtonClasses}
                  >
                    Save
                  </button>
                  {exists && (
                    <button
                      type="submit"
                      name="action"
                      value="delete"
                      className="border border-sand px-5 py-2 text-sm text-ink-soft transition-colors duration-200 hover:border-glow-ember hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
                    >
                      Delete row
                    </button>
                  )}
                </div>
              </form>
            );
          })}
        </div>
      ))}

      {/* New-key form (the API applies NO key whitelist): keys are free-form,
          so the admin can introduce copy rows the storefront will render once
          code reads them — the seeded keys cover today's storefront, but
          white-label re-configuration may need new ones (round-B gap, closed). */}
      <div className="flex flex-col gap-3 border-t border-sand pt-6">
        <h2 className="font-serif text-xl font-normal">Add a new key</h2>
        <form
          method="post"
          action="/admin/api/site-content"
          className="flex max-w-xl flex-col gap-1"
        >
          <label htmlFor="new-site-key" className="text-base text-charcoal">
            Key
          </label>
          <input
            id="new-site-key"
            name="key"
            type="text"
            required
            className={inputClasses}
          />
          <label htmlFor="new-site-locale" className="text-base text-charcoal">
            Locale
          </label>
          <select
            id="new-site-locale"
            name="locale"
            defaultValue={DEFAULT_SITE_CONTENT_LOCALES[0]}
            className={inputClasses}
          >
            {DEFAULT_SITE_CONTENT_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {locale}
              </option>
            ))}
          </select>
          <label htmlFor="new-site-value" className="text-base text-charcoal">
            Value
          </label>
          <textarea
            id="new-site-value"
            name="value"
            rows={3}
            required
            className={inputClasses}
          />
          <p className="text-sm text-ink-soft">
            Creates {"<key>"} for one locale — add the second locale from the
            row the key then gets above. The key must be non-empty and NUL-free;
            the value non-empty (the API judges).
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              name="action"
              value="save"
              className={saveButtonClasses}
            >
              Save
            </button>
          </div>
        </form>
      </div>

      <Link href="/admin" className="text-sm text-ink-soft underline">
        ← Back to admin
      </Link>
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { adminGet } from "../../../../lib/admin-client.ts";
import {
  CURRENCY_KEY,
  REQUIRED_KEYS,
  isSettingsKey,
  settingRowModel,
  type SettingRowModel,
} from "../../../../lib/admin-settings.ts";
import { resolveSiteConfig } from "../../../../lib/config.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../lib/admin-session.ts";

/*
  Admin settings page (D2b task 3, ADMIN-01, SCOPE-01): the founder toggle
  spec over the seven company keys, as plain HTML forms with NO client JS.

  Toggle semantics (presence-wins, lib/admin-settings.ts): ON -> the value
  saves; OFF -> the input renders DISABLED and greyed (the OFF reality) and
  the key persists EMPTY; "Delete override" reverts to the env default. The
  "toggle" is the button set per row — with no JS the grey-out is
  SERVER-RENDERED from the persisted state, which is the honest rendering:
  the field is disabled because the override IS empty, not because a
  checkbox says so. Required keys (brand.name, site.url) render NO OFF
  button and a RED warning when empty (the resolver throws without a brand
  name); currency has NO OFF state (always resolves, default HKD).

  Reads `GET /api/settings` (public, whitelist-only, INCLUDES empties —
  verified in api/src/content.rs): the empty override is exactly what makes
  OFF distinguishable from reverted. The fetch goes through adminGet (session
  forwarded; the endpoint is public but the read is admin-scoped plumbing).
  Anything but a 200 with a flat string map renders a fail-loud error panel
  and NO forms — never render invented state.

  Writes go through the relay `app/admin/api/settings/[key]` (one plain form
  per key; `name="action"` buttons carry save/off/revert). The relay answers
  303 with a slug-only query (`?saved=<key>` / `?error=<slug>`): the API's
  raw error text never enters a URL (logs/favorites surface, house rule).

  `?saved=<key>` is echoed only for keys of the closed settings set (an
  untrusted query string is never rendered); `?error=` maps through a Map
  (untrusted values can never reach an inherited property) with a generic
  fallback.

  Confirmation banner: globals.css has NO green token (CSS-01: tokens
  only, no hex/inline styles), so the positive signal is the lamp glow
  accent — the single saturated colour of the site.

  `export const dynamic = "force-dynamic"` (admin views show CURRENT DB
  state, never cached) and searchParams is a Promise in Next 15.
*/

export const metadata: Metadata = { title: "Settings" };

/** Served per request: admin state is live DB state, never cache it. */
export const dynamic = "force-dynamic";

/** Slug -> operator-facing message (exact strings, safe to render). */
const errorMessages = new Map<string, string>([
  ["invalid", "Invalid value — not saved. Check the field hint."],
  ["notauthenticated", "Session expired — sign in again."],
  [
    "network",
    "The admin API is unreachable or rejected the change — retry later.",
  ],
]);

/**
 * Parse `GET /api/settings`'s flat `{ key: string }` map, restricted to the
 * closed key set. A non-object body or any non-string value is NOT a valid
 * overrides map -> null (the page then renders the error panel, never
 * invented state).
 */
function parseOverrides(json: unknown): Record<string, string> | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(json)) {
    if (typeof value !== "string") return null;
    if (isSettingsKey(key)) out[key] = value;
  }
  return out;
}

/** "override: <value>" / "explicitly OFF ..." / "no override — env default". */
function stateNote(row: SettingRowModel): string {
  if (row.state === "on") return `override: ${row.overrideValue ?? ""}`;
  if (row.state === "off") return "explicitly OFF (empty override persisted)";
  return `no override — env default: ${row.envDefault ?? "(unset)"}`;
}

interface AdminSettingsPageProps {
  searchParams: Promise<{ saved?: string; error?: string }>;
}

export default async function AdminSettingsPage({
  searchParams,
}: AdminSettingsPageProps) {
  // Session gate (whoami-confirmed; redirects when missing/expired) plus the
  // raw cookie value for the API read.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  const fetched = await adminGet(apiUrl, "/api/settings", sessionValue);
  const overrides = fetched.status === 200 ? parseOverrides(fetched.json) : null;

  const { saved, error } = await searchParams;
  const savedMessage =
    saved !== undefined && isSettingsKey(saved)
      ? `Saved ${saved} — the storefront's 60-second content lease expires; the next request serves the last-good value while the fresh one regenerates in the background.`
      : null;
  const errorMessage =
    error === undefined ? null : (errorMessages.get(error) ?? "Nothing saved.");

  if (overrides === null) {
    // Fail loud, render NOTHING else: forms over unknown state are lies.
    return (
      <section className="flex flex-col gap-4">
        <h1 className="font-serif text-2xl font-normal">Settings</h1>
        <p
          role="alert"
          className="border-l-4 border-glow-ember pl-4 text-lg leading-relaxed text-charcoal"
        >
          Settings could not be loaded from the API — retry later.
        </p>
        <Link href="/admin" className="text-sm text-ink-soft underline">
          ← Back to admin
        </Link>
      </section>
    );
  }

  const rows = settingRowModel(overrides, process.env);

  // Fail-loud resolution check (lib/config.ts): throws when the brand name
  // resolves to nothing. The row model's `missingRequired` drives the red
  // warning; the catch covers the trim edge (a whitespace-only brand
  // override classifies ON but resolves empty).
  let resolveFailed = false;
  try {
    resolveSiteConfig(overrides);
  } catch {
    resolveFailed = true;
  }
  // Merge BOTH warning sources (review finding): the row model's
  // presence-wins missingRequired (required key with empty override OR
  // no env default) AND the resolver's actual throw (a whitespace-only
  // brand.name override classifies ON but resolves empty). Union, deduped,
  // display order — never let a nonempty list discard the other source.
  const warningKeys = [
    ...new Set([
      ...rows.filter((row) => row.missingRequired).map((row) => row.key),
      ...(resolveFailed ? [REQUIRED_KEYS[0]] : []),
    ]),
  ];

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-normal">Settings</h1>
        <p className="text-base leading-relaxed text-ink-soft">
          Company settings (SCOPE-01). ON saves a value; OFF persists the key
          empty (explicitly off); deleting the override reverts to the env
          default. Content fetches carry a 60-second revalidation lease:
          the next request after expiry serves the last-good value while
          the fresh one regenerates in the background (request-triggered
          stale-while-revalidate — no deadline promise, per the D2b
          webhook decision).
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

      {warningKeys.length > 0 && (
        <p
          role="alert"
          className="border border-error border-l-4 px-4 py-3 text-lg leading-relaxed text-charcoal"
        >
          Required setting empty: {warningKeys.join(", ")} — the storefront
          cannot render without it. Save a value below (an empty value is
          rejected for required settings).
        </p>
      )}

      {rows.map((row) => {
        const inputId = `setting-${row.key}`;
        const hintId = `${inputId}-hint`;
        return (
          <form
            key={row.key}
            method="post"
            action={`/admin/api/settings/${row.key}`}
            className="flex max-w-xl flex-col gap-3 border-t border-sand pt-6"
          >
            <label htmlFor={inputId} className="text-base text-charcoal">
              {row.label}
              {row.required
                ? " (required, no OFF state)"
                : row.key === CURRENCY_KEY
                  ? " (no OFF state)"
                  : ""}
            </label>
            <input
              id={inputId}
              name="value"
              type="text"
              defaultValue={
                row.state === "off"
                  ? ""
                  : (row.overrideValue ?? row.envDefault ?? "")
              }
              aria-describedby={hintId}
              className={
                row.state === "off"
                  ? // MUTED but NOT disabled (review finding): a disabled
                    // input is omitted from form submission, so Save on an
                    // OFF row would silently re-persist the empty override.
                    // The founder spec's "greys out" is the VISUAL state —
                    // muted classes — while the input stays submitable:
                    // type a value + Save turns the key back ON directly
                    // (the empty override persists until a nonempty save).
                    "border border-sand bg-ecru px-3 py-2 text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
                  : "border border-sand bg-bone px-3 py-2 text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
              }
            />
            <p id={hintId} className="text-sm text-ink-soft">
              {row.hint}
            </p>
            <p className="text-sm text-ink-soft">
              Current state: {stateNote(row)} — effective: {row.effective}
            </p>
            {row.missingRequired && (
              <p
                role="alert"
                className="border-l-4 border-error pl-3 text-sm text-charcoal"
              >
                {row.key} resolves EMPTY —{" "}
                {row.state === "off" ?
                  "the empty override suppresses the env default"
                  : "no override and no env default"}
                — required, cannot be turned OFF.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                name="action"
                value="save"
                className="border border-charcoal px-5 py-2 text-sm text-charcoal transition-colors duration-200 hover:border-glow hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
              >
                Save
              </button>
              {/* Optional keys only: required keys have no OFF state (the
                  API 400s an empty value), and currency has NO OFF state
                  either (founder spec: always resolves, default HKD — an
                  empty currency would 400 the ISO check anyway). */}
              {!row.required && row.key !== CURRENCY_KEY && (
                <button
                  type="submit"
                  name="action"
                  value="off"
                  className="border border-sand px-5 py-2 text-sm text-ink-soft transition-colors duration-200 hover:border-glow-ember hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
                >
                  Turn OFF (persist empty)
                </button>
              )}
              {(row.state === "on" || row.state === "off") && (
                <button
                  type="submit"
                  name="action"
                  value="revert"
                  className="border border-sand px-5 py-2 text-sm text-ink-soft transition-colors duration-200 hover:border-glow-ember hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
                >
                  Delete override (revert to env default)
                </button>
              )}
            </div>
          </form>
        );
      })}

      <Link href="/admin" className="text-sm text-ink-soft underline">
        ← Back to admin
      </Link>
    </section>
  );
}

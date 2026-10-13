import type { Metadata } from "next";
import Link from "next/link";

import { adminGet } from "../../../../lib/admin-client.ts";
import {
  DEFAULT_SITE_CONTENT_LOCALES,
  PRODUCT_CONTENT_FIELDS,
  parseAuditLog,
} from "../../../../lib/admin-editors.ts";
import {
  getAdminSessionValue,
  requireAdminSession,
} from "../../../../lib/admin-session.ts";

/*
  Admin audit page (D2b task 4, ADMIN-01): READ-ONLY view of the last 200
  audit rows (the API orders them newest-first and serves no more — this
  page renders that order as-is). Plain HTML, NO forms and NO client JS;
  ENGLISH-ONLY admin (app/admin/layout.tsx); `globals.css` token classes
  only (CSS-01).

  Reads `GET /api/admin/audit-log` via `adminGet` (session forwarded) and
  parses with the round-A model (lib/admin-editors.ts `parseAuditLog`):
  anything but a 200 with a fully valid list renders a fail-loud error
  panel — never render invented rows (a partial audit trail is a lie).
  `detail` is UNVALIDATED JSON: it is rendered via JSON.stringify when
  present (React escapes the text — it is data, never markup) and "-"
  when absent. `entity_id` renders as "-" when null. Timestamps render as
  the API's ISO strings, untouched.

  The slug banners below are the same shared machinery as the other editor
  pages (`?saved=` echo + `?error=` Map); no relay targets this read-only
  page, so `?saved=` can only carry a key from the round-A dispatcher
  vocabulary — the closed pattern admits exactly those shapes and nothing
  else. Raw searchParams are never rendered.

  `export const dynamic = "force-dynamic"` (admin views show CURRENT DB
  state, never cached) and searchParams is a Promise in Next 15.
*/

export const metadata: Metadata = { title: "Audit log" };

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
 * Closed allowlist pattern for `?saved=`: the full round-A dispatcher
 * savedKey vocabulary (`product <slug|id>`, `<id> <locale> <field>`,
 * `reference price for product <id>`, `piece <no>`, `<key> (<locale>)`).
 * No relay redirects to this read-only page, so the pattern is a pure
 * gate: only a key the dispatchers could have produced is ever echoed.
 */
const savedKeyPattern = new RegExp(
  "^(?:product [a-z0-9-]{1,64}|" +
    `[0-9]+ (?:${DEFAULT_SITE_CONTENT_LOCALES.join("|")}) (?:${PRODUCT_CONTENT_FIELDS.join("|")})|` +
    "reference price for product [0-9]+|piece [0-9]+|" +
    "[^\\x00-\\x1f\\x7f]{1,200} \\([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\\))$",
);

interface AdminAuditPageProps {
  searchParams: Promise<{ saved?: string; error?: string }>;
}

export default async function AdminAuditPage({
  searchParams,
}: AdminAuditPageProps) {
  // Session gate (whoami-confirmed; redirects when missing/expired) plus the
  // raw cookie value for the API read.
  const sessionValue = (await getAdminSessionValue()) ?? "";
  await requireAdminSession();

  // Same static env access as lib/availability.ts (inlined at build).
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() ?? "";
  const fetched = await adminGet(apiUrl, "/api/admin/audit-log", sessionValue);
  const rows = fetched.status === 200 ? parseAuditLog(fetched.json) : null;

  const { saved, error } = await searchParams;
  const savedMessage =
    saved !== undefined && savedKeyPattern.test(saved)
      ? `Saved ${saved} — the storefront's 60-second content lease expires; the next request serves the last-good value while the fresh one regenerates in the background.`
      : null;
  const errorMessage =
    error === undefined ? null : (errorMessages.get(error) ?? "Nothing saved.");

  if (rows === null) {
    // Fail loud, render NOTHING else: invented audit rows are lies.
    return (
      <section className="flex flex-col gap-4">
        <h1 className="font-serif text-2xl font-normal">Audit log</h1>
        <p
          role="alert"
          className="border-l-4 border-glow-ember pl-4 text-lg leading-relaxed text-charcoal"
        >
          The audit log could not be loaded from the API — retry later.
        </p>
        <Link href="/admin" className="text-sm text-ink-soft underline">
          ← Back to admin
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-normal">Audit log</h1>
        <p className="text-base leading-relaxed text-ink-soft">
          The last 200 admin mutations, newest first (the API serves no
          more). Read-only.
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

      <table className="w-full border-collapse text-sm text-charcoal">
        <thead>
          <tr className="border-b border-charcoal">
            <th className="px-3 py-2 text-left font-normal text-ink-soft">
              When (UTC)
            </th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">Actor</th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">Action</th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">Entity</th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">Entity ID</th>
            <th className="px-3 py-2 text-left font-normal text-ink-soft">Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-sand">
              {/* The API's ISO string, rendered as-is (never reformatted). */}
              <td className="px-3 py-2 whitespace-nowrap">{row.created_at}</td>
              <td className="px-3 py-2">{row.actor}</td>
              <td className="px-3 py-2">{row.action}</td>
              <td className="px-3 py-2">{row.entity}</td>
              <td className="px-3 py-2">{row.entity_id ?? "-"}</td>
              <td className="px-3 py-2 break-words text-xs text-ink-soft">
                {row.detail !== null ? JSON.stringify(row.detail) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Link href="/admin" className="text-sm text-ink-soft underline">
        ← Back to admin
      </Link>
    </section>
  );
}

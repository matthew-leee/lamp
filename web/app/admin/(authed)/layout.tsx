import type { ReactNode } from "react";

import { requireAdminSession } from "../../../lib/admin-session.ts";

/*
  Authenticated admin shell (D2b, ADMIN-01). The route GROUP — parentheses —
  keeps /admin/login and the /admin/api/* relay routes OUTSIDE this layout,
  so only the console pages are session-gated.

  requireAdminSession() reads the web-host cookie and confirms it with the
  Rust API's /api/admin/whoami (session forwarding, server-side only) —
  unauthenticated requests redirect to /admin/login. The logout control is a
  plain HTML form POSTing to the web logout relay (no client JS).

  Brand: raw env with the neutral "Admin" fallback, same pattern and reason
  as app/admin/login/page.tsx (the shell must render with the API down).
  ENGLISH-ONLY ADMIN (documented decision): operator tooling is not part of
  the bilingual customer contract (I18N-01); see app/admin/layout.tsx.
*/

export default async function AdminAuthedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { username } = await requireAdminSession();
  const brand = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Admin";

  return (
    <div className="flex min-h-dvh flex-col bg-bone text-charcoal">
      <header className="flex items-center justify-between gap-4 border-b border-sand px-6 py-4">
        <span className="font-serif text-xl">{brand}</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-soft">
            signed in as {username}
          </span>
          <form method="post" action="/admin/api/logout">
            <button
              type="submit"
              className="border border-charcoal px-4 py-1.5 text-sm text-charcoal transition-colors duration-200 hover:border-glow hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}

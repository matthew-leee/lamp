import type { Metadata } from "next";
import type { ReactNode } from "react";

import "../globals.css";

/*
  Admin document shell (D2b, ADMIN-01).

  WHY THIS FILE EXISTS (deviation from the eight-file plan, kept minimal):
  the app deliberately has no root `app/layout.tsx` (web/README.md — the
  locale layout is the root for `app/[lang]`, and a root layout cannot see
  `[lang]` params). Next 15's app loader exits `next build` for any page
  whose chain has NO layout (`"... doesn't have a root layout"`), so the
  admin tree — which sits OUTSIDE the locale tree — needs its own document
  root here. `app/admin/login` and `app/admin/(authed)` share this shell;
  only this file renders <html>/<body> for admin.

  ENGLISH-ONLY ADMIN (documented decision): the admin console is operator
  tooling. The bilingual contract (I18N-01) is the STOREFRONT's customer
  contract, not the admin's, so the admin tree declares `lang="en"` and
  renders English only. It is also a private surface: robots.txt disallows
  /admin/ and the metadata below refuses indexing.

  Styling (CSS-01): token classes from app/globals.css only — no inline
  styles, no hex. Fonts use generic stacks like the bare 404 shell
  (components/not-found-content.tsx): the next/font variables live in the
  [lang] layout and do not exist in the admin tree.
*/

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-bone text-charcoal">{children}</body>
    </html>
  );
}

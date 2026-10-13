import Link from "next/link";

import { requireAdminSession } from "../../../lib/admin-session.ts";

/*
  Admin dashboard (D2b, ADMIN-01): the landing page of the authenticated
  shell. Task 4 landed the editor surface: products (list/create/patch,
  copy, reference prices, pieces), site content and the audit log — the
  placeholder is now the console's link list.

  requireAdminSession() is called again here (layouts cannot pass props to
  pages) for the signed-in username — the second whoami is a cheap,
  no-store read against the API.

  ENGLISH-ONLY ADMIN (documented decision; see app/admin/layout.tsx).
*/

export default async function AdminDashboardPage() {
  const { username } = await requireAdminSession();

  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-normal">Admin</h1>
      <p className="text-lg leading-relaxed text-charcoal">
        Signed in as {username}
      </p>
      <ul className="flex flex-col gap-2 text-base leading-relaxed">
        <li>
          <Link
            href="/admin/products"
            className="underline transition-colors duration-200 hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
          >
            Products
          </Link>{" "}
          — the catalogue, stock, product copy, reference prices and
          numbered pieces.
        </li>
        <li>
          <Link
            href="/admin/settings"
            className="underline transition-colors duration-200 hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
          >
            Settings
          </Link>{" "}
          — company settings toggles.
        </li>
        <li>
          <Link
            href="/admin/site-content"
            className="underline transition-colors duration-200 hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
          >
            Site content
          </Link>{" "}
          — site copy per key and locale.
        </li>
        <li>
          <Link
            href="/admin/audit"
            className="underline transition-colors duration-200 hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
          >
            Audit log
          </Link>{" "}
          — the last 200 admin mutations (read-only).
        </li>
      </ul>
    </section>
  );
}

import Link from "next/link";

import { requireAdminSession } from "../../../lib/admin-session.ts";

/*
  Admin dashboard (D2b, ADMIN-01): the landing page of the authenticated
  shell. Settings is live (task 3, the founder toggle spec); products and
  content editors land in task 4 (still a placeholder line).

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
            href="/admin/settings"
            className="underline transition-colors duration-200 hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
          >
            Settings
          </Link>{" "}
          — company settings toggles (live).
        </li>
        <li className="text-ink-soft">
          Products / content editors — placeholder for the next task.
        </li>
      </ul>
    </section>
  );
}

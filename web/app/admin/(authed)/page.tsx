import { requireAdminSession } from "../../../lib/admin-session.ts";

/*
  Admin dashboard (D2b, ADMIN-01): the placeholder landing page of the
  authenticated shell. Catalogue, settings and content editors land in the
  next tasks (D2b 3-4 replace the placeholder line with real panels).

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
      <p className="text-base leading-relaxed text-ink-soft">
        Catalogue, settings and content editors land in the next tasks.
      </p>
    </section>
  );
}

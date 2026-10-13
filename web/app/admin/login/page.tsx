import type { Metadata } from "next";

/*
  Admin sign-in page (D2b, ADMIN-01): a plain HTML form, no client JS
  (house style is minimal JS). It POSTs to the web login relay
  (app/admin/api/login), which relays to the Rust API and re-sets the
  session cookie — the browser never talks to the API.

  ENGLISH-ONLY ADMIN (documented decision): operator tooling is not part of
  the bilingual customer contract (I18N-01); see app/admin/layout.tsx.

  Brand from the RAW env with a neutral "Admin" fallback (deliberately NOT
  lib/config resolveSiteConfig): the sign-in page must render even when the
  API is down or unconfigured — it is what an operator opens to FIX an
  outage — and resolveSiteConfig is a fail-loud build/config path that
  depends on settings fetched from the API.

  Error rendering: the relay redirects with a safe SLUG only
  (?error=... — never the API's raw error text, query params are a
  logs/favorites surface). The Map below is the exact closed set of
  messages; an unknown slug renders NO message (Map.get — untrusted query
  values can never reach an inherited property the way an object index
  could, review finding: ?error=__proto__ must render no message, not
  Object.prototype).

  Reading searchParams makes this route dynamic (Next 15: searchParams is
  a Promise) — correct for a form page that must reflect the redirect.
*/

export const metadata: Metadata = { title: "Sign in" };

/** Slug -> operator-facing message (exact strings, safe to render). */
const errorMessages = new Map<string, string>([
  ["invalid", "Invalid username or password."],
  [
    "notready",
    "Admin sign-in is not ready yet (SESSION_SECRET/admin not configured on the API). Retry later.",
  ],
  ["busy", "Too many concurrent sign-in attempts. Retry shortly."],
  ["network", "The admin API is unreachable. Retry later."],
  ["form", "Username and password are required."],
]);

interface AdminLoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function AdminLoginPage({
  searchParams,
}: AdminLoginPageProps) {
  const { error } = await searchParams;
  const message = error === undefined ? undefined : errorMessages.get(error);
  const brand = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Admin";

  return (
    <main className="flex min-h-dvh w-full max-w-4xl flex-col items-start bg-bone px-6 py-12 text-charcoal">
      <p className="text-sm uppercase tracking-widest text-ink-soft">{brand}</p>
      <h1 className="mt-2 font-serif text-4xl font-normal leading-[1.35]">
        Admin sign-in
      </h1>

      {message !== undefined && (
        <p
          role="alert"
          className="mt-6 border-l-4 border-glow-ember pl-4 text-lg leading-relaxed text-charcoal"
        >
          {message}
        </p>
      )}

      <form
        method="post"
        action="/admin/api/login"
        className="mt-8 flex w-full max-w-sm flex-col gap-5"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="username" className="text-sm text-ink-soft">
            Username
          </label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            required
            className="border border-sand bg-bone px-3 py-2 text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm text-ink-soft">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="border border-sand bg-bone px-3 py-2 text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
          />
        </div>
        <button
          type="submit"
          className="border border-charcoal px-5 py-2 text-sm text-charcoal transition-colors duration-200 hover:border-glow hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-glow"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}

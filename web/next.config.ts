import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework in response headers.
  poweredByHeader: false,
  // Locale routing lives in app/[lang] with generateStaticParams() +
  // dynamicParams = false. No middleware by design (T1 decision).
  experimental: {
    // Next 15 `global-not-found` convention: lets app/global-not-found.tsx
    // render the whole document (own <html lang>) for URLs that match no
    // route tree at all. It is the only way to set the document language on
    // the bare 404 shell without a root layout or middleware.
    globalNotFound: true,
  },
};

export default nextConfig;

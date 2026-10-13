import type { Metadata } from "next";

import NotFoundContent, {
  notFoundMetadata,
} from "@/components/not-found-content";

/*
  Locale-scoped not-found boundary: safety net for notFound() thrown inside
  the locale tree. Unreachable today: dynamicParams = false plus static
  generation mean every valid path is known, and unmatched paths (including
  /en/nope, /zh-HK/nope) never enter this tree; they are served by
  app/global-not-found.tsx. A request-time catch-all was removed because
  notFound() thrown during SSR escapes the locale layout in this
  no-root-layout setup and the recovered document loses its lang attribute.
*/

export const metadata: Metadata = notFoundMetadata;

export default function NotFound() {
  return <NotFoundContent />;
}

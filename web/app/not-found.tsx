import type { Metadata } from "next";

import NotFoundContent, {
  notFoundMetadata,
} from "@/components/not-found-content";

/*
  Root not-found boundary (safety net for notFound() thrown at the root
  layer). Content is shared with app/[lang]/not-found.tsx and
  app/global-not-found.tsx; see components/not-found-content.tsx for why it
  styles itself inline with generic font stacks.

  URLs that match no route tree at all (e.g. /, /fr) are served by
  app/global-not-found.tsx instead, which owns the bare <html>/<body> shell
  so the document still declares its language.
*/

export const metadata: Metadata = notFoundMetadata;

export default function NotFound() {
  return <NotFoundContent />;
}

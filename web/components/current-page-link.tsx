"use client";
/**
 * Link that adds `aria-current="page"` only when the visitor is actually on
 * the link's route (review finding 5).
 *
 * The shared header is rendered from app/[lang]/layout.tsx, a server
 * component that cannot know the request path, so the smallest honest fix is
 * a tiny client wrapper around usePathname(). This is the only client JS the
 * header buys. The rejected alternative was dropping aria-current entirely;
 * keeping it correct gives assistive tech a real current-page indication.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface CurrentPageLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
}

export default function CurrentPageLink({
  href,
  className,
  children,
}: CurrentPageLinkProps) {
  const pathname = usePathname();
  return (
    <Link
      href={href}
      className={className}
      aria-current={pathname === href ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import AppShell from "./AppShell";
export default function V8ShellRouter({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (
    path === "/v8" ||
    path.startsWith("/v8/") ||
    path === "/design" ||
    path.startsWith("/design/")
  )
    return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}

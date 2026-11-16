"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthProvider } from "../lib/auth-context";
export default function PlatformProviders({
  children,
}: {
  children: ReactNode;
}) {
  const path = usePathname();
  // /v8 is independently rejected on the server outside explicit development preview.
  // An unauthenticated context is sufficient for isolated sample pages; no fake identity.
  const preview = path === "/v8" || path.startsWith("/v8/");
  return (
    <AuthProvider
      key={preview ? "preview" : "platform"}
      checkSession={!preview}
    >
      {children}
    </AuthProvider>
  );
}

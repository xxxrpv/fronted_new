import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import V8ShellRouter from "../components/V8ShellRouter";
import PlatformProviders from "../components/PlatformProviders";

export const metadata: Metadata = {
  title: "Embodex · 设计工作空间",
  description: "从设计需求到概念与三维成果",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <PlatformProviders>
          <V8ShellRouter>{children}</V8ShellRouter>
        </PlatformProviders>
      </body>
    </html>
  );
}

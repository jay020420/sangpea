import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Codex PDP Maker",
  description: "Codex OAuth based local PDP generation and redesign tool"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

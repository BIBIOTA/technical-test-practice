import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Interview Practice",
  description: "AI-powered technical interview practice with spaced repetition",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

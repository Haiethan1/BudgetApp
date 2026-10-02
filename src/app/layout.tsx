import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Homebooks",
  description: "Self-hosted household spending and category budgets",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

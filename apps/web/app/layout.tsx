import type { Metadata } from "next";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Trace Marketplace",
  description: "Sell the sessions your coding agent already logs. Scrubbed on your machine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <Header />
        {children}
      </body>
    </html>
  );
}

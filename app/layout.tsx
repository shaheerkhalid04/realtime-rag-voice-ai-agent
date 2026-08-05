import type { Metadata, Viewport } from "next";

import { Footer, Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Attune — a voice that only speaks from your documents",
  description:
    "A real-time voice assistant built on Vapi, grounded by a Pinecone retrieval pipeline and answered by Groq. Speak a question, hear an answer your documents actually support.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Nav />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}

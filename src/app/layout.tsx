import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Needle Drop — Unlimited song guessing",
  description: "Guess the Spotify song from a progressively longer intro.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

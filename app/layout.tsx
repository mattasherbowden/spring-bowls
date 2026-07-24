import type { Metadata } from "next";
import { Nunito, Fredoka, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Nunito({
  variable: "--f-body",
  subsets: ["latin"],
});

const display = Fredoka({
  variable: "--f-display",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--f-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Spring Bowls · BYO British Person Edition",
  description:
    "The 7th Spring Bowls lawn-bowls tournament. Log in to see your next game, live scores, group tables and the awards.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

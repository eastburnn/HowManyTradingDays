import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://howmanytradingdays.com"),
  title: "How Many Trading Days",
  description: "U.S. trading days remaining this year",

  openGraph: {
    title: "How Many Trading Days",
    description: "See how many U.S. stock market trading days are left this year.",
    url: "https://howmanytradingdays.com",
    siteName: "How Many Trading Days",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "How Many Trading Days — how many stock market trading days are left this year",
      },
    ],
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "How Many Trading Days",
    description: "U.S. stock market trading days remaining this year.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
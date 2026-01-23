import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const GA_MEASUREMENT_ID = "G-4CY0XQWF9B";

// Use Eastern Time so the year doesn't "flip" early/late around New Year's
function getCurrentYearET(): number {
  const yearStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date());

  return Number(yearStr);
}

// Dynamic metadata (runs on the server)
export function generateMetadata(): Metadata {
  const year = getCurrentYearET();

  const title = `How Many Trading Days Are Left In ${year}`;
  const description =
    "Live countdown of how many U.S. stock market trading days are left this year, excluding weekends and NYSE holidays (half days count as 0.5).";

  return {
    metadataBase: new URL("https://howmanytradingdays.com"),
    title,
    description,

    alternates: {
      canonical: "https://howmanytradingdays.com/",
    },

    openGraph: {
      title,
      description,
      url: "https://howmanytradingdays.com",
      siteName: "How Many Trading Days",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "How Many Trading Days — U.S. stock market trading days left this year",
        },
      ],
      type: "website",
    },

    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* Google Analytics */}
      <head>
        <Script
          async
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </head>

      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}

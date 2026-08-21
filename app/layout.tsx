import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
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
    "Live countdown of U.S. stock market trading days left this year, excluding weekends and NYSE holidays — plus a calculator for any future date.";

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
        {/* WebSite structured data — tells Google the site name to show in results */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "How Many Trading Days",
              alternateName: "HowManyTradingDays.com",
              url: "https://howmanytradingdays.com/",
            }),
          }}
        />
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

        {/* Microsoft Clarity */}
        <Script id="clarity-init" strategy="afterInteractive">
          {`
            (function(c,l,a,r,i,t,y){
                c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
                t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
                y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "y5zm8itf0u");
          `}
        </Script>
      </head>

      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-950 text-slate-50 min-h-screen flex flex-col`}>
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}

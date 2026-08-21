import type { Metadata } from "next";

const title = "Trading Days Calculator";
const description =
  "Calculate how many trading days remain between today and any future date, skipping weekends and all NYSE holidays.";

export const metadata: Metadata = {
  title,
  description,

  alternates: {
    canonical: "/calculator",
  },

  openGraph: {
    title,
    description,
    url: "https://howmanytradingdays.com/calculator",
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

export default function CalculatorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}

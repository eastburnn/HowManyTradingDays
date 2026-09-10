import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        // Merged into the in-a-year page (consolidating the "trading days
        // in a year / per year" query family onto one URL)
        source: "/trading-days-by-year",
        destination: "/trading-days-in-a-year",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

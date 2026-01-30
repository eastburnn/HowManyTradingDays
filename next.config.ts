import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [
          {
            type: "host",
            value: "www.howmanytradingdays.com",
          },
        ],
        destination: "https://howmanytradingdays.com/:path*",
        permanent: true, // 308
      },
    ];
  },
};

export default nextConfig;

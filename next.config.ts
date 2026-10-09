import type { NextConfig } from "next";
import { computeLogicVersions } from "./lib/earnings/logicHash";

// Fingerprints of the earnings pipeline's logic, fixed at build time. When a
// deploy changes them, the next scheduled tick reprocesses the whole site by
// itself (see syncLogicFlush in lib/earnings/jobs.ts).
const logic = computeLogicVersions();

const nextConfig: NextConfig = {
  env: {
    EARNINGS_LOGIC_COMPANY: logic.company,
    EARNINGS_LOGIC_FEEDS: logic.feeds,
  },
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

import type { MetadataRoute } from "next";
import { getIndexedTickers } from "@/lib/earnings/queries";
import { CHUNK_SIZE } from "./earnings/sitemap";

export const revalidate = 86400;

export default async function robots(): Promise<MetadataRoute.Robots> {
  let chunks = 1;
  try {
    const tickers = await getIndexedTickers();
    chunks = Math.max(1, Math.ceil(tickers.length / CHUNK_SIZE));
  } catch {
    // Database unavailable: still advertise the first earnings sitemap
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/jobs/"] }],
    sitemap: [
      "https://howmanytradingdays.com/sitemap.xml",
      ...Array.from({ length: chunks }, (_, id) => `https://howmanytradingdays.com/earnings/sitemap/${id}.xml`),
    ],
  };
}

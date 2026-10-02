import type { MetadataRoute } from "next";
import { getIndexedTickers } from "@/lib/earnings/queries";

/**
 * Chunked sitemaps for the ticker pages, served at /earnings/sitemap/[id].xml
 * and listed in robots.txt. Only companies flagged `indexed` appear — the
 * staged rollout lives in that flag, not in code.
 */

export const revalidate = 86400;

export const CHUNK_SIZE = 5000;

export async function generateSitemaps() {
  const tickers = await getIndexedTickers();
  const chunks = Math.max(1, Math.ceil(tickers.length / CHUNK_SIZE));
  return Array.from({ length: chunks }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const tickers = await getIndexedTickers();
  return tickers.slice(id * CHUNK_SIZE, (id + 1) * CHUNK_SIZE).map((t) => ({
    url: `https://howmanytradingdays.com/earnings/${t.ticker.toLowerCase()}`,
    lastModified: t.lastRefreshedAt ? new Date(t.lastRefreshedAt) : new Date(),
    changeFrequency: "weekly",
    priority: 0.6,
  }));
}

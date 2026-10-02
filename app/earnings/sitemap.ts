import type { MetadataRoute } from "next";
import { getIndexedTickers } from "@/lib/earnings/queries";

/**
 * Chunked sitemaps for the ticker pages, served at /earnings/sitemap/[id].xml
 * and listed in robots.txt. Only companies flagged `indexed` appear — the
 * staged rollout lives in that flag, not in code.
 */

export const revalidate = 86400;

export const CHUNK_SIZE = 5000;

// A database outage must never fail the site build: fall back to an empty
// sitemap and let the next revalidation fill it in.
async function safeIndexedTickers() {
  try {
    return await getIndexedTickers();
  } catch (err) {
    console.error("[earnings sitemap] database unavailable:", (err as Error).message);
    return [];
  }
}

export async function generateSitemaps() {
  const tickers = await safeIndexedTickers();
  const chunks = Math.max(1, Math.ceil(tickers.length / CHUNK_SIZE));
  return Array.from({ length: chunks }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const tickers = await safeIndexedTickers();
  return tickers.slice(id * CHUNK_SIZE, (id + 1) * CHUNK_SIZE).map((t) => ({
    url: `https://howmanytradingdays.com/earnings/${t.ticker.toLowerCase()}`,
    lastModified: t.lastRefreshedAt ? new Date(t.lastRefreshedAt) : new Date(),
    changeFrequency: "weekly",
    priority: 0.6,
  }));
}

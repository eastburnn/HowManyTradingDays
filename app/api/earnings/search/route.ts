import { NextResponse } from "next/server";
import { searchCompanies } from "@/lib/earnings/queries";
import { displayName } from "@/lib/earnings/format";

/**
 * GET /api/earnings/search?q=nvid — typeahead for the earnings lookup box.
 * Matches tickers (prefix) and company names (substring). CDN-cached per
 * query for ten minutes; the universe changes slowly.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  if (!q) return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "no-store" } });
  try {
    const hits = await searchCompanies(q, 8);
    return NextResponse.json(
      { results: hits.map((h) => ({ ...h, name: displayName(h.name) })) },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } }
    );
  } catch (err) {
    console.error("[search]", (err as Error).message);
    return NextResponse.json({ results: [] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

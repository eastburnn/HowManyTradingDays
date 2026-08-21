import type { MetadataRoute } from "next";
import { HOLIDAY_PAGES } from "@/lib/holidayPages";

export default function sitemap(): MetadataRoute.Sitemap {
  const holidayPages: MetadataRoute.Sitemap = HOLIDAY_PAGES.map((h) => ({
    url: `https://howmanytradingdays.com/is-the-stock-market-open/${h.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [
    {
      url: "https://howmanytradingdays.com/",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: "https://howmanytradingdays.com/trading-days-in-a-year",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: "https://howmanytradingdays.com/calculator",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: "https://howmanytradingdays.com/trading-days-by-year",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: "https://howmanytradingdays.com/stock-market-holidays",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: "https://howmanytradingdays.com/is-the-stock-market-open",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    ...holidayPages,
    {
      url: "https://howmanytradingdays.com/api-docs",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: "https://howmanytradingdays.com/about",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
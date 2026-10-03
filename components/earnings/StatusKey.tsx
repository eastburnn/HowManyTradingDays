import StatusBadge from "./StatusBadge";
import type { CalendarEvent } from "@/lib/earnings/calendar";

type Entry = Pick<CalendarEvent, "status" | "confidence"> & { meaning: string };

/** One row per chip the calendar can show, in the order a reader meets them. */
const ENTRIES: Entry[] = [
  {
    status: "confirmed",
    confidence: "high",
    meaning: "The company has announced this date, in a press release or on its investor site.",
  },
  {
    status: "estimated",
    confidence: "high",
    meaning: "Projected from the company's past reporting pattern in its SEC filings. Usually lands within a few days.",
  },
  {
    status: "estimated",
    confidence: "low",
    meaning: "The company's pattern is too irregular for a single date, so a range of likely days is shown instead.",
  },
  {
    status: "reported",
    confidence: "high",
    meaning: "Results are out. The earnings release has been filed with the SEC.",
  },
];

/** Key to the status chips, shown directly under the month calendar. */
export default function StatusKey() {
  return (
    <section aria-label="Key to the status chips" className="-mt-4 space-y-2">
      <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">Key</p>
      <ul className="space-y-2">
        {ENTRIES.map((e) => (
          <li key={`${e.status}-${e.confidence}`} className="flex items-start gap-3">
            <StatusBadge status={e.status} confidence={e.confidence} />
            <span className="text-xs text-slate-400 leading-relaxed">{e.meaning}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

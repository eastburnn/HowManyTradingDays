import StatusBadge from "./StatusBadge";
import type { CalendarEvent } from "@/lib/earnings/calendar";
import type { EstimateAccuracy } from "@/lib/earnings/queries";

type Tier = NonNullable<CalendarEvent["confidence"]>;
type Entry = { status: CalendarEvent["status"]; confidence: Tier; meaning: string };

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
    meaning: "Projected from the company's past reporting pattern in its SEC filings.",
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

/** Below this many checked quarters a percentage would say more about luck than the method. */
const MIN_CHECKED = 20;

function pct(part: number, whole: number): string {
  return `${Math.round((100 * part) / whole)}%`;
}

/** The track record lines for the two kinds of estimate, when enough quarters have been checked. */
function trackRecord(accuracy: EstimateAccuracy | null): Partial<Record<Tier, string>> {
  if (!accuracy) return {};
  const { estimated, window } = accuracy;
  return {
    high:
      estimated.checked >= MIN_CHECKED
        ? `Within 3 days of the actual date ${pct(estimated.within3, estimated.checked)} of the time so far, and within 7 days ${pct(estimated.within7, estimated.checked)}, across ${estimated.checked.toLocaleString("en-US")} checked.`
        : undefined,
    low:
      window.checked >= MIN_CHECKED
        ? `The actual date has fallen inside the range ${pct(window.inside, window.checked)} of the time so far, across ${window.checked.toLocaleString("en-US")} checked.`
        : undefined,
  };
}

/** Key to the status chips, shown directly under the month calendar. */
export default function StatusKey({ accuracy }: { accuracy: EstimateAccuracy | null }) {
  const record = trackRecord(accuracy);
  return (
    <section aria-label="Key to the status chips" className="-mt-4 space-y-2">
      <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">Key</p>
      {/* The same light border as the calendar above, with a row per chip */}
      <ul className="rounded-2xl border border-slate-300/30 divide-y divide-slate-300/20">
        {ENTRIES.map((e) => {
          const stat = e.status === "estimated" ? record[e.confidence] : undefined;
          return (
            <li key={`${e.status}-${e.confidence}`} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
              <StatusBadge status={e.status} confidence={e.confidence} />
              <span className="text-xs text-slate-400 leading-relaxed">
                {e.meaning}
                {stat && <span className="block text-slate-500">{stat}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

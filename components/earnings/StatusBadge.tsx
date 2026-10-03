import { type CalendarEvent, statusChip } from "@/lib/earnings/calendar";

/**
 * The status chip — Confirmed / Estimated / Window / Reported — at a fixed
 * width so a column of them lines up whatever the word.
 */
export default function StatusBadge({ status, confidence }: Pick<CalendarEvent, "status" | "confidence">) {
  const { label, className } = statusChip({ status, confidence });
  return (
    <span
      className={`inline-flex w-[5.75rem] shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}
    >
      {label}
    </span>
  );
}

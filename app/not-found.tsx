import Link from "next/link";
import { domine } from "./fonts";

export default function NotFound() {
  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-6 py-16">
        <h1 className={`${domine.className} text-2xl font-semibold text-slate-100`}>Page not found</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          There is nothing at this address. If you were looking for a company, try the earnings calendar and search by ticker.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/earnings" className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
            Earnings calendar
          </Link>
          <Link href="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}

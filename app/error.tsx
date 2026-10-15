"use client";

/**
 * Shown when a page fails to render (a database connection that could not be
 * had during a traffic burst, most likely). The data is still there; a retry
 * a moment later almost always works.
 */

import Link from "next/link";
import { useEffect } from "react";
import { domine } from "./fonts";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page] render failed:", error.message);
  }, [error]);
  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-6 py-16">
        <h1 className={`${domine.className} text-2xl font-semibold text-slate-100`}>Something went wrong loading this page</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          This is usually a momentary hiccup reaching our data. Trying again almost always works.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Try again
          </button>
          <Link href="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500">
            Go to the home page
          </Link>
        </div>
      </div>
    </main>
  );
}

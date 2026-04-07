export default function Footer() {
  return (
    <footer className="w-full border-t border-slate-800 bg-slate-950 mt-auto">
      <div className="max-w-xl mx-auto px-4 py-6 flex flex-col items-center gap-2 text-[10px] text-slate-500 text-center">
        <p>
          HowManyTradingDays.com &middot; U.S. equity markets only &middot; For informational purposes only.
        </p>

        <p className="flex items-center justify-center gap-2">
          Made by{" "}
          <a
            href="https://www.itschrisray.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-slate-400 hover:text-slate-300 transition-colors"
          >
            itschrisray.com
          </a>

          <span className="text-slate-700">&bull;</span>

          <a
            href="https://x.com/itschrisray"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
          >
            <img
              src="/twitter.png"
              alt="X Logo"
              className="h-3 w-3 opacity-70"
            />
            <span className="text-slate-400 hover:text-slate-300 transition-colors">
              @itschrisray
            </span>
          </a>
        </p>
      </div>
    </footer>
  );
}

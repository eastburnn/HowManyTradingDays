"use client";

/** The last resort when the root layout itself fails; must render its own html and body. */

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#020617", color: "#f8fafc", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "64px 16px" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ color: "#94a3b8", lineHeight: 1.6 }}>A momentary problem stopped this page from loading. Trying again almost always works.</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ background: "#10b981", color: "#020617", border: 0, borderRadius: 8, padding: "8px 16px", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

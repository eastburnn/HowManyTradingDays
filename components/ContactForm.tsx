"use client";

import Script from "next/script";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CONTACT_TOPICS, type ContactTopic, MESSAGE_MAX, MESSAGE_MIN } from "@/lib/contact";

/**
 * The contact form. Posts to /api/contact; the hidden "website" field, the
 * time the form appeared, and a Cloudflare Turnstile token travel with it
 * as spam checks. The page passes a preselected topic from its ?topic=
 * query parameter (the advertise page links here with topic=advertising).
 */

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string; field?: string | null };

const FALLBACK_EMAIL = "itschrisray@gmail.com";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "compact" | "flexible";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    }
  ) => string;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-500";

export default function ContactForm({ defaultTopic = "general" }: { defaultTopic?: ContactTopic }) {
  const id = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState<ContactTopic>(defaultTopic);
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [startedAt] = useState(() => Date.now()); // when the form appeared (never rendered)
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileEl = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/contact")
      .then((r) => r.json())
      .then((j: { enabled?: boolean }) => setEnabled(j.enabled !== false))
      .catch(() => setEnabled(true));
  }, []);

  // Render the Turnstile widget once its script is available (the script's
  // onLoad for a fresh load; the effect for a page the script is already on).
  const mountTurnstile = useCallback(() => {
    const el = turnstileEl.current;
    if (!TURNSTILE_SITE_KEY || !el || widgetId.current || !window.turnstile) return;
    widgetId.current = window.turnstile.render(el, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: "dark",
      size: "flexible",
      callback: (token) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => setTurnstileToken(null),
    });
  }, []);
  useEffect(() => {
    if (enabled !== false) mountTurnstile();
  }, [enabled, mountTurnstile]);

  const resetTurnstile = () => {
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    setTurnstileToken(null);
  };

  if (enabled === false) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-5 py-4 text-sm text-slate-300 space-y-2">
        <p>The contact form is offline for the moment.</p>
        <p>
          Please email{" "}
          <a href={`mailto:${FALLBACK_EMAIL}`} className="text-blue-300 hover:text-blue-200 transition-colors">
            {FALLBACK_EMAIL}
          </a>{" "}
          instead.
        </p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind === "sending") return;
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, topic, message, website, startedAt, turnstileToken: turnstileToken ?? undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; field?: string | null };
      if (res.ok && json.ok) {
        setStatus({ kind: "sent", email });
        setMessage("");
      } else {
        setStatus({ kind: "error", message: json.error ?? "Couldn't send your message. Please try again.", field: json.field });
      }
    } catch {
      setStatus({ kind: "error", message: "Couldn't reach the server. Please check your connection and try again." });
    } finally {
      resetTurnstile(); // tokens are single-use
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100 space-y-2">
        <p className="font-semibold">Message sent.</p>
        <p className="text-emerald-100/80">Thanks! I read every message and will reply to {status.email}.</p>
        <button
          type="button"
          onClick={() => {
            widgetId.current = null; // the widget unmounts with the form; render a fresh one
            setStatus({ kind: "idle" });
          }}
          className="text-xs underline text-emerald-200 hover:text-white transition-colors"
        >
          Send another
        </button>
      </div>
    );
  }

  const awaitingTurnstile = Boolean(TURNSTILE_SITE_KEY) && !turnstileToken;

  const field = (name: string) => (status.kind === "error" && status.field === name ? "border-rose-400/60" : "");

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-name`} className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Name
          </label>
          <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" className={`${INPUT} ${field("name")}`} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-email`} className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Email
          </label>
          <input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} autoComplete="email" inputMode="email" className={`${INPUT} ${field("email")}`} />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-topic`} className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Topic
        </label>
        <select id={`${id}-topic`} value={topic} onChange={(e) => setTopic(e.target.value as ContactTopic)} className={INPUT}>
          {CONTACT_TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor={`${id}-message`} className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Message
        </label>
        <textarea
          id={`${id}-message`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          minLength={MESSAGE_MIN}
          maxLength={MESSAGE_MAX}
          rows={6}
          placeholder={topic === "data" ? "Which ticker, what the site shows, and what the correct date is (a link to the company's announcement helps)." : "How can I help?"}
          className={`${INPUT} resize-y ${field("message")}`}
        />
        <p className="text-[11px] text-slate-600 text-right">
          {message.length}/{MESSAGE_MAX}
        </p>
      </div>

      {/* Honeypot: hidden from people, filled in by bots */}
      <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" />
      </div>

      {TURNSTILE_SITE_KEY && (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={mountTurnstile} />
          <div ref={turnstileEl} className="min-h-[65px]" aria-label="Verification" />
        </>
      )}

      {status.kind === "error" && (
        <p role="alert" className="rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
          {status.message}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Your name and email are used only to reply. See the{" "}
          <a href="/privacy" className="underline hover:text-slate-300 transition-colors">
            privacy policy
          </a>
          .
        </p>
        <button
          type="submit"
          disabled={status.kind === "sending" || awaitingTurnstile}
          title={awaitingTurnstile ? "Waiting for the verification check" : undefined}
          className="shrink-0 rounded-lg border border-blue-500/40 bg-blue-500/20 px-5 py-2 text-sm font-medium text-blue-200 hover:bg-blue-500/30 disabled:opacity-60 transition-colors"
        >
          {status.kind === "sending" ? "Sending…" : awaitingTurnstile ? "Verifying…" : "Send message"}
        </button>
      </div>
    </form>
  );
}

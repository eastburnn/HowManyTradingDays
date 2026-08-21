import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";

const title = "Privacy Policy — How Many Trading Days";
const description =
  "How HowManyTradingDays.com handles analytics, cookies, and affiliate links. We collect no accounts, no personal profiles, and sell no data.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/privacy" },
  openGraph: {
    title,
    description,
    url: "https://howmanytradingdays.com/privacy",
    siteName: "How Many Trading Days",
    type: "website",
  },
};

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className={`${domine.className} text-lg font-semibold text-slate-100`}>{heading}</h2>
      <div className="space-y-2 text-sm text-slate-400 leading-relaxed">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Privacy" }]} />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            Privacy Policy
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Effective August 21, 2026. The short version: this site has no accounts, collects no
            names or emails, and sells no data. We use standard analytics to understand how the
            site is used, and some links are affiliate links.
          </p>
        </header>

        <Section heading="What we collect">
          <p>
            HowManyTradingDays.com is an informational site. You cannot create an account, and we
            never ask for your name, email address, or payment details. The information collected
            is limited to standard, largely anonymous usage data gathered by the analytics
            services below: pages visited, approximate location (country/city derived from IP),
            device and browser type, how you arrived at the site, and how you interact with pages
            (clicks, scrolling, time on page).
          </p>
        </Section>

        <Section heading="Analytics services">
          <p>
            We use <span className="text-slate-200">Google Analytics</span> to measure traffic
            (pages viewed, visit sources, engagement time). Google Analytics sets cookies to
            distinguish visitors. You can opt out with the{" "}
            <a
              href="https://tools.google.com/dlpage/gaoptout"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-300 hover:text-blue-200 transition-colors"
            >
              Google Analytics opt-out browser add-on
            </a>
            .
          </p>
          <p>
            We use <span className="text-slate-200">Microsoft Clarity</span> to understand how
            visitors use the site through heatmaps and anonymized session replays (mouse movement,
            clicks, and scrolling). This site has no text inputs for personal information, so
            replays do not contain personal data. See{" "}
            <a
              href="https://privacy.microsoft.com/privacystatement"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-300 hover:text-blue-200 transition-colors"
            >
              Microsoft&apos;s privacy statement
            </a>{" "}
            for how Clarity processes data.
          </p>
        </Section>

        <Section heading="Affiliate links and advertising">
          <p>
            Some links on this site are affiliate links, marked as sponsored. If you click one and
            make a purchase, we may earn a commission at no extra cost to you. The destination
            site may set a cookie to attribute the referral. We may also display advertising in
            the future; if we adopt an advertising network, this policy will be updated to
            describe its data practices.
          </p>
        </Section>

        <Section heading="Cookies">
          <p>
            Cookies on this site come from the services above (analytics and affiliate
            attribution). We set no cookies of our own for tracking. You can block or clear
            cookies in your browser settings at any time; the site works fully without them.
          </p>
        </Section>

        <Section heading="The API">
          <p>
            Requests to our free API are handled like any web request: our hosting provider
            (Vercel) processes standard request logs (IP address, timestamp, endpoint) to operate
            and protect the service. We do not use API requests to build profiles of callers.
          </p>
        </Section>

        <Section heading="Your rights">
          <p>
            Depending on where you live (for example, the EU under GDPR or California under
            CCPA), you may have rights to access, correct, or delete personal data. Because this
            site does not maintain accounts or store personal profiles, there is typically
            nothing for us to look up — the analytics data we hold is not identifiable to you by
            us. For anything related to Google&apos;s or Microsoft&apos;s processing, their
            privacy controls linked above are the effective path. You can also reach out with any
            question via the contact below.
          </p>
        </Section>

        <Section heading="Children">
          <p>
            This site is not directed at children under 13 and we do not knowingly collect
            personal information from them.
          </p>
        </Section>

        <Section heading="Changes and contact">
          <p>
            If our practices change (for example, adding an advertising network), we will update
            this page and its effective date. Questions? Reach out on{" "}
            <a
              href="https://x.com/itschrisray"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-300 hover:text-blue-200 transition-colors"
            >
              X @itschrisray
            </a>
            .
          </p>
        </Section>

        <div className="border-t border-slate-800 pt-6">
          <Link href="/" className="text-sm text-blue-300 hover:text-blue-200 transition-colors font-medium">
            ← Back to the live counter
          </Link>
        </div>
      </div>
    </main>
  );
}

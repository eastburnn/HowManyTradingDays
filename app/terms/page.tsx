import type { Metadata } from "next";
import Link from "next/link";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";

const title = "Terms of Service | How Many Trading Days";
const description =
  "The terms for using HowManyTradingDays.com and its API: an informational site, not investment advice, with no guarantee that any date, count, or estimate is correct.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/terms" },
  openGraph: {
    title,
    description,
    url: "https://howmanytradingdays.com/terms",
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

const linkClass = "text-blue-300 hover:text-blue-200 transition-colors";

export default function TermsPage() {
  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Terms" }]} />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight`}>
            Terms of Service
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Effective October 3, 2026. The short version: this is an informational site, not
            investment advice. Trading-day counts, market hours, holiday dates, and earnings dates
            can be wrong, late, or changed, and you use them at your own risk. Any decision you make
            with information from this site is yours alone, and we are not liable for its outcome.
          </p>
        </header>

        <Section heading="Agreement to these terms">
          <p>
            HowManyTradingDays.com (the &ldquo;site&rdquo;), including its pages, embedded tools, and
            API, is operated by Chris Ray (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;). By
            visiting the site, using any of its tools, or sending a request to its API, you agree to
            these terms and to our{" "}
            <Link href="/privacy" className={linkClass}>
              Privacy Policy
            </Link>
            . If you do not agree, do not use the site. You must be of legal age to form a binding
            contract where you live, and you are responsible for anyone who uses the site or the
            API through your connection or integration.
          </p>
        </Section>

        <Section heading="What the site is, and is not">
          <p>
            The site is a reference for people who think in trading days: how many are left in a
            period, whether U.S. markets are open, when the exchanges close for holidays, and when
            public companies are expected to report earnings. It is provided for general
            informational purposes only.
          </p>
          <p>
            Nothing on the site is investment, financial, trading, legal, tax, or accounting advice,
            and nothing on it is a recommendation, offer, or solicitation to buy, sell, or hold any
            security or to follow any strategy. We are not a broker-dealer, investment adviser,
            exchange, or data vendor registered with any regulator, and no fiduciary, advisory, or
            professional relationship is created by your use of the site. We are not affiliated
            with the U.S. Securities and Exchange Commission, the New York Stock Exchange, Nasdaq,
            or any company that appears on the site.
          </p>
        </Section>

        <Section heading="Earnings dates and other data">
          <p>
            Earnings dates on the site are produced automatically. Dates marked as estimated are
            projections from a company&apos;s past filing history with the SEC and can miss by days
            or weeks. Dates marked as confirmed come from company press releases, investor-relations
            pages, and other public announcements, which companies can change at any time and which
            we may read late, read incorrectly, or miss entirely. Dates marked as reported come from
            SEC filings and may be mismatched to the wrong period or company. Time-of-day labels,
            fiscal calendars, countdowns, and the accuracy figures shown beside estimates are
            approximations with the same limitations.
          </p>
          <p>
            Trading-day counts, market status, and holiday dates rely on published exchange
            schedules and on clocks and calendars that can be wrong, and they cannot anticipate
            unscheduled closures, early closes, trading halts, or schedule changes announced by the
            exchanges. The site may also be interrupted, cached, or out of date at any moment.
          </p>
          <p>
            For all of these reasons, no information on the site is guaranteed to be accurate,
            complete, current, or available, and we have no obligation to correct or update it.
            Always verify a date with the company itself and market hours with the exchange before
            acting on them.
          </p>
        </Section>

        <Section heading="Your decisions and your risk">
          <p>
            Trading and investing involve substantial risk, including the loss of your entire
            investment. Any decision you make after viewing the site, including acting on, or
            failing to act on, an earnings date, a trading-day count, or a market-status reading,
            is your own decision, made at your own risk, based on your own judgment and, where
            appropriate, the advice of a licensed professional. You agree that you will not rely on
            the site as the sole basis for any financial decision, and that we are not responsible
            for the results of any decision you make.
          </p>
        </Section>

        <Section heading="No warranties">
          <p>
            The site, its content, and its API are provided &ldquo;as is&rdquo; and &ldquo;as
            available&rdquo;, without warranties of any kind, express or implied, including any
            implied warranties of merchantability, fitness for a particular purpose,
            non-infringement, accuracy, timeliness, or uninterrupted or error-free operation. No
            advice or information you obtain from us or from the site creates any warranty not
            expressly stated here.
          </p>
        </Section>

        <Section heading="Limitation of liability">
          <p>
            To the fullest extent permitted by law, we will not be liable to you or to anyone else
            for any indirect, incidental, consequential, special, exemplary, or punitive damages, or
            for any lost profits, lost opportunities, trading or investment losses, missed events,
            lost data, or business interruption, arising out of or related to the site, its content,
            its API, or these terms, however caused and under any theory of liability, even if we
            have been advised of the possibility of such damages. This includes losses that result
            from an incorrect, late, missing, or changed earnings date, trading-day count, holiday
            date, or market-status reading.
          </p>
          <p>
            To the fullest extent permitted by law, our total liability for all claims arising out
            of or related to the site, its content, its API, or these terms will not exceed the
            amount you paid us to use the site in the twelve months before the claim, or one hundred
            U.S. dollars (US$100), whichever is greater. Some jurisdictions do not allow certain
            limitations or exclusions, so some of the above may not apply to you; in that case our
            liability is limited to the greatest extent the law allows.
          </p>
        </Section>

        <Section heading="Indemnification">
          <p>
            You agree to defend, indemnify, and hold harmless us and anyone who works with us on the
            site from any claims, losses, liabilities, damages, costs, and expenses (including
            reasonable attorneys&apos; fees) arising out of or related to your use of the site or
            its API, any decision you make with information from the site, any content or
            integration you build with the API, or your violation of these terms or of any law or
            third-party right.
          </p>
        </Section>

        <Section heading="The API">
          <p>
            The API is offered free of charge, without a key, for personal projects, research, and
            applications that make reasonable use of it. Everything in these terms about accuracy,
            warranties, and liability applies equally to data obtained through the API, and to
            anything you build with it. You are responsible for how your application presents that
            data to its users.
          </p>
          <p>
            We may apply rate limits, require registration or keys, change endpoints or response
            formats, or suspend or withdraw the API, in whole or for any caller, at any time and
            without notice. Do not use the API in a way that interferes with the site, send
            unreasonable volumes of requests, or attempt to circumvent limits or protections.
            Attribution to HowManyTradingDays.com in anything you build is appreciated but not
            required.
          </p>
        </Section>

        <Section heading="Acceptable use">
          <p>
            You may not use the site or the API for anything unlawful, to interfere with or disrupt
            the site or its infrastructure, to bypass security, verification, or rate-limiting
            measures, to collect data from the site in a way that burdens it, or to misrepresent
            the site&apos;s information as something it is not, including presenting estimates as
            confirmed facts.
          </p>
        </Section>

        <Section heading="Content and intellectual property">
          <p>
            The site&apos;s design, text, code, and branding belong to us. The underlying facts on
            the site, such as exchange holidays, filing dates, and announced earnings dates, are
            drawn from public sources, including SEC filings and company announcements, and we claim
            no ownership of those facts. Company names and tickers belong to their respective
            owners and appear for identification only. You may use the site&apos;s information for
            your own purposes subject to these terms; you may not copy the site itself or present
            its pages or images as your own.
          </p>
        </Section>

        <Section heading="Third-party links, affiliate links, and advertising">
          <p>
            The site links to third-party sites, including SEC filings, company investor-relations
            pages, and sponsored or affiliate links, which are marked as such. We do not control
            those sites, are not responsible for their content or practices, and do not endorse
            any product, service, or company by linking to it or by displaying its advertising. Any
            dealings you have with a third party, including an advertiser, are between you and that
            party.
          </p>
        </Section>

        <Section heading="Availability and changes">
          <p>
            We may change, suspend, or discontinue any part of the site or the API at any time,
            with or without notice, and we are not liable for any such change. We may also update
            these terms; the effective date at the top of this page shows the current version, and
            continued use of the site after a change means you accept the updated terms.
          </p>
        </Section>

        <Section heading="Governing law and disputes">
          <p>
            These terms are governed by the laws of the United States and of the state in which we
            reside, without regard to conflict-of-law rules. If you have a dispute with us, please
            contact us first so we can try to resolve it informally. Any claim that cannot be
            resolved that way must be brought in the state or federal courts located in that state,
            and you consent to their jurisdiction. Any claim arising out of the site must be filed
            within one year after it arises, or it is permanently barred, to the extent the law
            allows.
          </p>
        </Section>

        <Section heading="General">
          <p>
            These terms and the Privacy Policy are the entire agreement between you and us about the
            site. If any part of these terms is found unenforceable, the rest remains in effect. Our
            failure to enforce a provision is not a waiver of it. You may not assign these terms;
            we may assign them to a successor operator of the site. Headings are for convenience
            only.
          </p>
        </Section>

        <Section heading="Contact">
          <p>
            Questions about these terms? Use the{" "}
            <Link href="/contact" className={linkClass}>
              contact form
            </Link>{" "}
            or email{" "}
            <a href="mailto:hello@howmanytradingdays.com" className={linkClass}>
              hello@howmanytradingdays.com
            </a>
            .
          </p>
        </Section>

        <div className="border-t border-slate-800 pt-6">
          <Link href="/" className="text-sm text-blue-300 hover:text-blue-200 transition-colors font-medium">
            ← Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}

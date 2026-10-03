import type { Metadata } from "next";
import { domine } from "../fonts";
import Breadcrumbs from "@/components/Breadcrumbs";
import ContactForm from "@/components/ContactForm";
import { CONTACT_TOPICS, type ContactTopic } from "@/lib/contact";

const title = "Contact — How Many Trading Days";
const description =
  "Questions, advertising, a wrong earnings date, or something broken: send a message to HowManyTradingDays.com.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/contact" },
  openGraph: {
    title,
    description,
    url: "https://howmanytradingdays.com/contact",
    siteName: "How Many Trading Days",
    type: "website",
  },
};

// Rendered per request so ?topic= (from the advertise page) can preselect a topic.
export default async function ContactPage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  const defaultTopic = CONTACT_TOPICS.some((t) => t.value === topic) ? (topic as ContactTopic) : "general";
  return (
    <main className="flex-1 flex items-start justify-center px-4">
      <div className="max-w-xl w-full flex flex-col gap-8 py-12">
        <Breadcrumbs crumbs={[{ label: "Home", href: "/" }, { label: "Contact" }]} />

        <header className="space-y-2">
          <h1 className={`${domine.className} text-3xl sm:text-4xl font-semibold tracking-tight text-balance`}>
            Contact
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            A question about the site, an advertising inquiry, an earnings date that looks wrong, or something
            that isn&apos;t working — send a note. I read every message and reply by email, usually within a
            day.
          </p>
        </header>

        <section className="relative rounded-2xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6">
          <ContactForm defaultTopic={defaultTopic} />
        </section>
      </div>
    </main>
  );
}

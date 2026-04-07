import Link from "next/link";

type Crumb = { label: string; href?: string };

export default function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="w-full">
      <ol className="flex items-center gap-1.5 text-xs text-slate-500">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <svg className="w-3 h-3 text-slate-700 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
              {isLast || !crumb.href ? (
                <span className={isLast ? "text-slate-300 font-medium" : "text-slate-500"}>
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className="hover:text-slate-300 transition-colors">
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

import Link from "next/link";
import { ArrowLeft, Link as LinkIcon, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { changelog } from "@/data/changelog";
import type { ChangelogEntryType } from "@/data/changelog";

const typeLabel: Record<ChangelogEntryType, string> = {
  feature: "Feature",
  improvement: "Improvement",
  fix: "Fix",
  breaking: "Breaking",
};

const typeStyles: Record<ChangelogEntryType, string> = {
  feature: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  improvement: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25",
  fix: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/25",
  breaking: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25",
};

export default function ChangelogPage() {
  return (
    <>
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Home
      </Link>

      <div className="mb-10 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <ScrollText className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Changelog</h1>
          <p className="text-sm text-muted-foreground">
            What&apos;s new in VibeCodes
          </p>
        </div>
      </div>

      {changelog.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entries yet.</p>
      ) : (
      <div className="space-y-8 border-l border-border py-2 pl-10">
        {changelog.map((entry) => (
          <article key={entry.isoDate} id={entry.isoDate} className="relative scroll-mt-24">
            {/* Timeline dot — decorative */}
            <div aria-hidden="true" className="absolute -left-[2.9rem] top-1.5 h-3 w-3 rounded-full border-2 border-primary bg-background" />

            <header className="mb-4">
              <a
                href={`#${entry.isoDate}`}
                className="group inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <time dateTime={entry.isoDate}>
                  {entry.date}
                </time>
                <LinkIcon className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
              <h2 className="mt-1 text-xl font-semibold">{entry.title}</h2>
            </header>

            <ul className="list-none space-y-2">
              {entry.items.map((item, index) => (
                <li key={index} className="flex items-start gap-3">
                  <Badge
                    variant="outline"
                    className={`mt-0.5 shrink-0 text-xs ${typeStyles[item.type]}`}
                  >
                    {typeLabel[item.type]}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {item.description}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      )}
    </>
  );
}

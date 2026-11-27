import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PipelineFlow } from "@/components/landing/pipeline-flow";
import { GUIDE_SECTIONS } from "@/components/guide/guide-sections";

export default function GuidePage() {
  return (
    <div>
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight">VibeCodes Guide</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Type one line about an idea and get a whole project: a board full of
          cards, a team of AI agents, and workflows that move the cards for you.
          This guide explains every part, in plain English.
        </p>
      </div>

      <div className="mb-12 rounded-xl border border-border bg-muted/30 p-8">
        <p className="mb-6 text-center text-sm font-medium text-muted-foreground">
          How it fits together
        </p>
        <PipelineFlow />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {GUIDE_SECTIONS.map((section) => (
          <Link key={section.slug} href={`/guide/${section.slug}`}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <div className={`mb-2 flex h-10 w-10 items-center justify-center rounded-lg ${section.bgClass}`}>
                  <section.icon className={`h-5 w-5 ${section.iconClass}`} />
                </div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  {section.title}
                  {section.isNew && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                      New page
                    </span>
                  )}
                </CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

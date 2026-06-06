import { Skeleton } from "@/components/ui/skeleton";

export default function GuideLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Header */}
      <Skeleton className="mb-2 h-8 w-52" />
      <Skeleton className="mb-8 h-4 w-80" />

      {/* Guide card grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border p-5">
            <Skeleton className="mb-3 h-8 w-8 rounded-lg" />
            <Skeleton className="mb-2 h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-1 h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

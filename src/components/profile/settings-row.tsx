import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** One row in the settings list: an icon, a label + short description, and the
 *  actual working control on the right (the existing dialog trigger button, or
 *  a plain link for `href`-only rows like Manage agents).
 */
export function SettingsRow({
  icon: Icon,
  title,
  description,
  action,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
      {href && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block transition-colors hover:bg-accent/50 rounded-lg">
        {body}
      </Link>
    );
  }

  return body;
}


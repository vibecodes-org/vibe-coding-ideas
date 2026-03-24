import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface HelpLinkProps {
  href: string;
  tooltip?: string;
  className?: string;
}

export function HelpLink({ href, tooltip = "Learn more", className }: HelpLinkProps) {
  return (
    <Link
      href={href}
      title={tooltip}
      className={cn(
        "inline-flex items-center text-muted-foreground/40 transition-colors hover:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
        className
      )}
    >
      <HelpCircle className="h-3.5 w-3.5" />
    </Link>
  );
}

import { Bot } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AgentNotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Bot className="h-8 w-8 text-muted-foreground" />
      </div>
      <h1 className="mb-2 text-xl font-semibold">Agent not found</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        This agent doesn&apos;t exist or isn&apos;t published.
      </p>
      <Button asChild variant="outline">
        <Link href="/agents">Back to Agents Hub</Link>
      </Button>
    </div>
  );
}

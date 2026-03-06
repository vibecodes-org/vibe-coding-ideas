"use client";

import { CopyButton } from "./copy-button";

export function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative rounded-lg border-2 border-primary/30 bg-muted p-4 pr-10">
      <code className="text-sm break-all">{code}</code>
      <CopyButton
        text={code}
        className="absolute right-2 top-2"
      />
    </div>
  );
}

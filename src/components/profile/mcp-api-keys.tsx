"use client";

import { useState, useTransition, useEffect } from "react";
import { KeyRound, Plus, Trash2, Copy, Check, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { generateApiKey, listApiKeys, revokeApiKey } from "@/actions/api-keys";
import type { ApiKeyRow } from "@/actions/api-keys";
import { formatDistanceToNow } from "date-fns";

interface McpApiKeysProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function McpApiKeys({ open: controlledOpen, onOpenChange: controlledOnOpenChange }: McpApiKeysProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen! : internalOpen;
  const setOpen = isControlled
    ? (v: boolean) => controlledOnOpenChange!(v)
    : setInternalOpen;

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [isPending, startTransition] = useTransition();

  // Load keys when dialog opens; reset state when it closes
  useEffect(() => {
    if (!open) {
      // Deferred reset so closing animation isn't interrupted
      const t = setTimeout(() => {
        setGeneratedKey(null);
        setNewKeyName("");
        setCopied(false);
      }, 200);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    listApiKeys()
      .then((rows) => { if (!cancelled) setKeys(rows); })
      .catch(() => { if (!cancelled) toast.error("Failed to load API keys"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  function handleGenerate() {
    if (!newKeyName.trim()) return;
    startTransition(async () => {
      try {
        const key = await generateApiKey(newKeyName);
        setGeneratedKey(key);
        setKeys((prev) => [
          { id: "new", name: newKeyName.trim(), created_at: new Date().toISOString(), last_used_at: null, expires_at: null },
          ...prev,
        ]);
        setNewKeyName("");
        // Reload to get real ID
        listApiKeys().then(setKeys).catch(() => {});
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to generate key");
      }
    });
  }

  function handleCopy() {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleRevoke() {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setRevokeTarget(null);
    startTransition(async () => {
      try {
        await revokeApiKey(target.id);
        setKeys((prev) => prev.filter((k) => k.id !== target.id));
        toast.success(`Key "${target.name}" revoked`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to revoke key");
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        {!isControlled && (
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Terminal className="h-4 w-4" />
              MCP API Keys
            </Button>
          </DialogTrigger>
        )}
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              MCP API Keys
            </DialogTitle>
            <DialogDescription>
              Generate keys to connect tools like Codex to the VibeCodes MCP server without OAuth.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Generated key banner — shown once */}
            {generatedKey && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
                <p className="text-xs font-medium text-emerald-400">
                  Copy this key now — it won&apos;t be shown again.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-black/30 px-2 py-1 text-xs font-mono text-emerald-300">
                    {generatedKey}
                  </code>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Set <code className="font-mono">VIBECODES_API_KEY={generatedKey.slice(0, 12)}…</code> in your environment.
                </p>
              </div>
            )}

            {/* Generate new key form */}
            <div className="flex gap-2">
              <Input
                placeholder="Key name, e.g. My Codex session"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                maxLength={100}
                disabled={isPending}
              />
              <Button
                onClick={handleGenerate}
                disabled={isPending || !newKeyName.trim()}
                className="shrink-0 gap-1.5"
              >
                <Plus className="h-4 w-4" />
                Generate
              </Button>
            </div>

            {/* Keys list */}
            {loading ? (
              <p className="text-sm text-muted-foreground py-2">Loading…</p>
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No API keys yet.</p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {keys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{key.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Created {formatDistanceToNow(new Date(key.created_at), { addSuffix: true })}
                        {key.last_used_at
                          ? ` · Last used ${formatDistanceToNow(new Date(key.last_used_at), { addSuffix: true })}`
                          : " · Never used"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setRevokeTarget(key)}
                      disabled={isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Codex config snippet */}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground transition-colors">
                How to connect Codex
              </summary>
              <pre className="mt-2 rounded bg-muted/50 p-2 overflow-x-auto text-[11px] leading-relaxed">{`{
  "mcpServers": {
    "vibecodes": {
      "type": "http",
      "url": "https://vibecodes.co.uk/api/mcp",
      "bearer_token_env_var": "VIBECODES_API_KEY"
    }
  }
}`}</pre>
            </details>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(v) => !v && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{revokeTarget?.name}&rdquo; will be permanently deleted. Any client using it will lose access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

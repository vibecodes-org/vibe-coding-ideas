"use client";

import { useEffect, useState, useTransition } from "react";
import { Github } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { disconnectGithub, getGithubConnection, type GithubConnectionInfo } from "@/actions/github";
import { formatDistanceToNow } from "date-fns";

export function GithubConnection() {
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<GithubConnectionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRevoke, setShowRevoke] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getGithubConnection()
      .then((c) => {
        if (!cancelled) setConnection(c);
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load GitHub connection");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleConnect() {
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `/api/github/start?return_to=${encodeURIComponent(returnTo)}`;
  }

  function handleDisconnect() {
    setShowRevoke(false);
    startTransition(async () => {
      try {
        await disconnectGithub();
        setConnection(null);
        toast.success("GitHub disconnected");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to disconnect");
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Github className="h-4 w-4" />
            GitHub
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              GitHub Connection
            </DialogTitle>
            <DialogDescription>
              Connect to browse and create repos when linking ideas.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {loading ? (
              <p className="text-sm text-muted-foreground py-4">Loading…</p>
            ) : connection ? (
              <div className="flex items-center gap-3 rounded-md border border-border p-3">
                {connection.github_avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={connection.github_avatar_url}
                    alt={connection.github_login}
                    className="h-10 w-10 rounded-full"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">@{connection.github_login}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Connected {formatDistanceToNow(new Date(connection.connected_at), { addSuffix: true })}
                    {connection.scopes.length > 0 && (
                      <> · scopes: {connection.scopes.join(", ")}</>
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/40 hover:border-destructive hover:bg-destructive/10"
                  onClick={() => setShowRevoke(true)}
                  disabled={isPending}
                >
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  We&apos;ll request <code className="font-mono">repo</code> and{" "}
                  <code className="font-mono">read:user</code> scopes so you can browse and create
                  repos from any idea page. You can disconnect at any time.
                </div>
                <Button onClick={handleConnect} className="w-full gap-2">
                  <Github className="h-4 w-4" />
                  Connect GitHub
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showRevoke} onOpenChange={setShowRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing idea–repo links will keep working as plain URLs. You&apos;ll need to reconnect
              to browse or create repos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

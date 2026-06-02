"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Github, Lock, Search, Globe } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  createGithubRepo,
  getGithubConnection,
  linkRepoToIdea,
  listMyGithubRepos,
  type GithubConnectionInfo,
  type RepoSummary,
} from "@/actions/github";
import { toRepoName, parseRepoUrl } from "@/lib/github";

interface GithubLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  ideaTitle: string;
  currentUrl: string | null;
  onLinked: (url: string) => void;
}

type Mode = "browse" | "create" | "manual";

export function GithubLinkDialog({
  open,
  onOpenChange,
  ideaId,
  ideaTitle,
  currentUrl,
  onLinked,
}: GithubLinkDialogProps) {
  const [connection, setConnection] = useState<GithubConnectionInfo | null>(null);
  const [loadingConnection, setLoadingConnection] = useState(false);
  const [mode, setMode] = useState<Mode>("browse");
  const [isPending, startTransition] = useTransition();
  const fetchedReposRef = useRef(false);

  // Browse state
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [filter, setFilter] = useState("");

  // Create state
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createPrivate, setCreatePrivate] = useState(true);
  const [createInitReadme, setCreateInitReadme] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Manual state
  const [manualUrl, setManualUrl] = useState(currentUrl ?? "");

  // Reset all state when dialog re-opens
  useEffect(() => {
    if (!open) return;
    fetchedReposRef.current = false;
    setMode("browse");
    setRepos([]);
    setPage(1);
    setHasMore(false);
    setFilter("");
    setCreateName(toRepoName(ideaTitle));
    setCreateDesc("");
    setCreatePrivate(true);
    setCreateInitReadme(false);
    setCreateError(null);
    setManualUrl(currentUrl ?? "");
  }, [open, ideaTitle, currentUrl]);

  // Load connection info when dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingConnection(true);
    getGithubConnection()
      .then((c) => {
        if (cancelled) return;
        setConnection(c);
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to check GitHub connection");
      })
      .finally(() => {
        if (!cancelled) setLoadingConnection(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Lazy-load first page of repos when entering Browse mode (connected only)
  useEffect(() => {
    if (!open || !connection || mode !== "browse" || fetchedReposRef.current) return;
    fetchedReposRef.current = true;
    void loadRepoPage(1, true);
  }, [open, connection, mode]);

  async function loadRepoPage(p: number, replace: boolean) {
    setLoadingRepos(true);
    try {
      const next = await listMyGithubRepos(p);
      setRepos((prev) => (replace ? next : [...prev, ...next]));
      setPage(p);
      setHasMore(next.length === 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load repos";
      if (message.includes("expired")) {
        // Token was auto-disconnected server-side — re-check connection
        setConnection(null);
        fetchedReposRef.current = false;
      }
      toast.error(message);
    } finally {
      setLoadingRepos(false);
    }
  }

  const filteredRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q))
    );
  }, [repos, filter]);

  function handleConnect() {
    const returnTo = window.location.pathname + window.location.search;
    window.location.href = `/api/github/start?return_to=${encodeURIComponent(returnTo)}`;
  }

  function handlePickRepo(repo: RepoSummary) {
    startTransition(async () => {
      try {
        const url = await linkRepoToIdea(ideaId, repo.html_url, "browse");
        onLinked(url);
        onOpenChange(false);
        toast.success(`Linked to ${repo.full_name}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to link repo");
      }
    });
  }

  function handleCreate() {
    setCreateError(null);
    const cleaned = toRepoName(createName);
    if (!cleaned) {
      setCreateError("Pick a name that contains letters or numbers");
      return;
    }
    startTransition(async () => {
      try {
        const repo = await createGithubRepo({
          name: cleaned,
          description: createDesc,
          isPrivate: createPrivate,
          initReadme: createInitReadme,
        });
        const url = await linkRepoToIdea(ideaId, repo.html_url, "create");
        onLinked(url);
        onOpenChange(false);
        toast.success(`Created ${repo.full_name} and linked`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create repo";
        if (message.toLowerCase().includes("repository creation failed")) {
          setCreateError(`A repo named "${cleaned}" already exists. Try a different name.`);
        } else if (message.includes("expired")) {
          setConnection(null);
          fetchedReposRef.current = false;
          toast.error(message);
        } else {
          setCreateError(message);
        }
      }
    });
  }

  function handleManualSave() {
    // Validate client-side so the user gets a specific message. Server-action
    // error messages are masked in production builds, so relying on the thrown
    // message ("Not a valid GitHub repository URL") never reaches the toast.
    const normalized = parseRepoUrl(manualUrl);
    if (!normalized) {
      toast.error("Not a valid GitHub repository URL");
      return;
    }
    startTransition(async () => {
      try {
        const url = await linkRepoToIdea(ideaId, normalized, "manual");
        onLinked(url);
        onOpenChange(false);
        toast.success("Repository linked");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Invalid GitHub URL");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Link a GitHub repo
          </DialogTitle>
          <DialogDescription>
            {connection ? (
              <>Connected as <span className="font-medium text-foreground">@{connection.github_login}</span></>
            ) : (
              "Connect your account to browse or create repos here."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {loadingConnection ? (
            <p className="text-sm text-muted-foreground py-4">Checking GitHub connection…</p>
          ) : !connection && mode !== "manual" ? (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                We&apos;ll request <code className="font-mono">repo</code> and{" "}
                <code className="font-mono">read:user</code> scopes. You can disconnect any time
                from Profile settings.
              </div>
              <Button onClick={handleConnect} className="w-full gap-2">
                <Github className="h-4 w-4" />
                Connect GitHub
              </Button>
            </div>
          ) : connection ? (
            <Tabs value={mode === "manual" ? "browse" : mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="browse">Browse</TabsTrigger>
                <TabsTrigger value="create">Create new</TabsTrigger>
              </TabsList>

              <TabsContent value="browse" className="space-y-3 mt-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Filter your repos…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                  {loadingRepos && repos.length === 0 ? (
                    <RepoSkeleton />
                  ) : filteredRepos.length === 0 && !loadingRepos ? (
                    <div className="p-8 text-center">
                      <Github className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                      <p className="text-sm font-medium">
                        {repos.length === 0 ? "No repos yet" : "No repos match your filter"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 mb-3">
                        {repos.length === 0
                          ? "You haven't created any GitHub repos on this account."
                          : "Try a different search term."}
                      </p>
                      {repos.length === 0 && (
                        <Button size="sm" onClick={() => setMode("create")}>
                          + Create your first repo
                        </Button>
                      )}
                    </div>
                  ) : (
                    <ul>
                      {filteredRepos.map((r) => (
                        <li key={r.id}>
                          <button
                            onClick={() => handlePickRepo(r)}
                            disabled={isPending}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 border-b border-border last:border-b-0 disabled:opacity-50"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={r.owner_avatar_url}
                              alt=""
                              className="h-7 w-7 rounded shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <span className="truncate" title={r.full_name}>
                                  {r.name}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0">
                                  {r.is_private ? (
                                    <>
                                      <Lock className="h-2.5 w-2.5" /> Private
                                    </>
                                  ) : (
                                    <>
                                      <Globe className="h-2.5 w-2.5" /> Public
                                    </>
                                  )}
                                </span>
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {r.language ? <>{r.language} · </> : null}
                                Updated {formatDistanceToNow(new Date(r.pushed_at), { addSuffix: true })}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                      {hasMore && (
                        <li className="border-t border-border">
                          <button
                            onClick={() => loadRepoPage(page + 1, false)}
                            disabled={loadingRepos}
                            className="w-full text-center py-2 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {loadingRepos ? "Loading…" : "Load more"}
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="create" className="space-y-3 mt-3">
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                    Repository name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="my-cool-project"
                    autoFocus
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Created under <span className="font-medium text-foreground">@{connection.github_login}</span>. Letters, numbers, dashes — no spaces.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                    Description (optional)
                  </label>
                  <Input
                    value={createDesc}
                    onChange={(e) => setCreateDesc(e.target.value)}
                    placeholder="Short description shown on GitHub"
                  />
                </div>
                <label className="flex items-start gap-2.5 rounded-md border border-border p-2.5 cursor-pointer hover:bg-muted/30">
                  <input
                    type="checkbox"
                    checked={createPrivate}
                    onChange={(e) => setCreatePrivate(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Private repository</div>
                    <div className="text-[11px] text-muted-foreground">Only you can see it on GitHub.</div>
                  </div>
                </label>
                <label className="flex items-start gap-2.5 rounded-md border border-border p-2.5 cursor-pointer hover:bg-muted/30">
                  <input
                    type="checkbox"
                    checked={createInitReadme}
                    onChange={(e) => setCreateInitReadme(e.target.checked)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Initialise with README</div>
                    <div className="text-[11px] text-muted-foreground">
                      Skip if you plan to push from an existing local directory.
                    </div>
                  </div>
                </label>
                {createError && (
                  <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {createError}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          ) : null}

          {mode === "manual" && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                Repository URL
              </label>
              <Input
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Paste any github.com repo URL — public or private.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex sm:justify-between gap-2 items-center">
          <button
            type="button"
            onClick={() => setMode(mode === "manual" ? "browse" : "manual")}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            {mode === "manual" ? "← back to browse" : "paste a URL instead"}
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {mode === "create" && connection && (
              <Button onClick={handleCreate} disabled={isPending}>
                {isPending ? "Creating…" : "Create & link"}
              </Button>
            )}
            {mode === "manual" && (
              <Button onClick={handleManualSave} disabled={isPending || !manualUrl.trim()}>
                Save
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RepoSkeleton() {
  return (
    <ul>
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-b-0"
        >
          <div className="h-7 w-7 rounded bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 bg-muted rounded animate-pulse" />
            <div className="h-2.5 w-20 bg-muted/60 rounded animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  );
}

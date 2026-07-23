"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Github,
  Globe,
  Info,
  Link2,
  Loader2,
  Lock,
  Search,
  XCircle,
} from "lucide-react";
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
  verifyRepoAccess,
  type GithubConnectionInfo,
  type RepoAccessCheck,
  type RepoSummary,
} from "@/actions/github";
import { toRepoName, parseRepoUrl } from "@/lib/github";
import type { RepoAccessState } from "@/lib/github-verify";

interface GithubLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  ideaTitle: string;
  currentUrl: string | null;
  onLinked: (url: string) => void;
}

type Mode = "browse" | "create" | "manual";

/** Local UI state for the verification panel under the URL input. */
type VerifyPanelState = { kind: "idle" } | { kind: "checking" } | ({ kind: "result" } & RepoAccessCheck);

const VERIFY_DEBOUNCE_MS = 500;

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
  const defaultTabSetRef = useRef(false);

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

  // Manual (Paste URL) state
  const [manualUrl, setManualUrl] = useState(currentUrl ?? "");
  const [verify, setVerify] = useState<VerifyPanelState>({ kind: "idle" });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const lastVerifiedUrlRef = useRef<string | null>(null);
  const pastedRef = useRef(false);

  const isMalformed = useMemo(
    () => manualUrl.trim().length > 0 && parseRepoUrl(manualUrl) === null,
    [manualUrl]
  );

  // Reset all state when dialog re-opens
  useEffect(() => {
    if (!open) return;
    fetchedReposRef.current = false;
    defaultTabSetRef.current = false;
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
    setVerify({ kind: "idle" });
    lastVerifiedUrlRef.current = null;
    requestIdRef.current += 1;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, [open, ideaTitle, currentUrl]);

  // Load connection info when dialog opens. Also decides the smart default
  // tab (design §03 flow map) right here, from the freshly-resolved `c` —
  // NOT via a separate effect keyed on `loadingConnection`/`connection`,
  // because sibling effects in the same commit still see the pre-fetch state
  // (state updates from this effect aren't visible to others until the next
  // render), which raced and always picked the "disconnected" default.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingConnection(true);
    getGithubConnection()
      .then((c) => {
        if (cancelled) return;
        setConnection(c);
        if (!defaultTabSetRef.current) {
          defaultTabSetRef.current = true;
          setMode(!c || currentUrl ? "manual" : "browse");
        }
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
  }, [open, currentUrl]);

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

  // --- Repo reachability verification (V1–V6) ------------------------------

  async function runVerify(parsedUrl: string) {
    lastVerifiedUrlRef.current = parsedUrl;
    const myRequestId = (requestIdRef.current += 1);
    setVerify({ kind: "checking" });
    try {
      const result = await verifyRepoAccess(parsedUrl);
      if (myRequestId !== requestIdRef.current) return; // superseded by newer input
      setVerify({ kind: "result", ...result });
    } catch {
      if (myRequestId !== requestIdRef.current) return;
      // Never let a verification failure surface as an unhandled rejection or
      // block the user — degrade to the neutral "unreachable" panel (V6).
      setVerify({ kind: "result", state: "unreachable", owner: "", repo: "" });
    }
  }

  function scheduleVerify(url: string, immediate: boolean) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const parsed = parseRepoUrl(url);
    if (!parsed) {
      // Malformed or empty — no verification call; bump the request id so a
      // stale in-flight response for a previous value can't land afterwards.
      requestIdRef.current += 1;
      lastVerifiedUrlRef.current = null;
      setVerify({ kind: "idle" });
      return;
    }
    if (immediate) {
      if (parsed === lastVerifiedUrlRef.current) return; // already checked/checking this exact repo
      void runVerify(parsed);
    } else {
      debounceRef.current = setTimeout(() => void runVerify(parsed), VERIFY_DEBOUNCE_MS);
    }
  }

  function handleManualUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setManualUrl(value);
    const wasPaste = pastedRef.current;
    pastedRef.current = false;
    scheduleVerify(value, wasPaste);
  }

  function handleManualUrlBlur() {
    scheduleVerify(manualUrl, true);
  }

  function handleManualUrlPaste() {
    // onPaste fires before the browser commits the new value / before the
    // resulting onChange — flag it so the very next onChange verifies
    // immediately instead of waiting out the debounce.
    pastedRef.current = true;
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
        if (verify.kind === "result" && verify.state === "no_connection") {
          toast.success("Saved. Connect GitHub to verify repos.");
        } else if (verify.kind === "result" && (verify.state === "ok_public" || verify.state === "ok_private")) {
          toast.success(`Linked to ${verify.owner}/${verify.repo}`);
        } else {
          toast.success("Repository linked");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Invalid GitHub URL");
      }
    });
  }

  const saveLabel =
    verify.kind === "result" && verify.state === "not_found_or_no_access" ? "Save anyway" : "Save";
  const saveDisabled = isPending || !manualUrl.trim() || isMalformed;

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
              "Not connected — you can still link any public or private repo by URL."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {loadingConnection ? (
            <p className="text-sm text-muted-foreground py-4">Checking GitHub connection…</p>
          ) : (
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger
                  value="browse"
                  className={!connection ? "text-muted-foreground/50" : undefined}
                >
                  My repos
                </TabsTrigger>
                <TabsTrigger
                  value="create"
                  className={!connection ? "text-muted-foreground/50" : undefined}
                >
                  New repo
                </TabsTrigger>
                <TabsTrigger value="manual" className="gap-1.5">
                  <Link2 className="h-3.5 w-3.5" />
                  Paste URL
                </TabsTrigger>
              </TabsList>

              <TabsContent value="browse" className="space-y-3 mt-3">
                {!connection ? (
                  <ConnectPrompt
                    message="Connect GitHub to browse and link one of your own repos."
                    onConnect={handleConnect}
                  />
                ) : (
                  <>
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
                  </>
                )}
              </TabsContent>

              <TabsContent value="create" className="space-y-3 mt-3">
                {!connection ? (
                  <ConnectPrompt
                    message="Connect GitHub to create a new repo here."
                    onConnect={handleConnect}
                  />
                ) : (
                  <>
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
                  </>
                )}
              </TabsContent>

              <TabsContent value="manual" className="space-y-2 mt-3">
                {!connection && (
                  <h3 className="text-sm font-medium text-foreground">Working in someone else&apos;s repo?</h3>
                )}
                <div>
                  <label className="block text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wide">
                    Repository URL
                  </label>
                  <Input
                    value={manualUrl}
                    onChange={handleManualUrlChange}
                    onBlur={handleManualUrlBlur}
                    onPaste={handleManualUrlPaste}
                    placeholder="https://github.com/owner/repo"
                    autoFocus
                    aria-invalid={isMalformed}
                    aria-describedby="github-url-verify-panel"
                    className={isMalformed ? "border-destructive focus-visible:ring-destructive" : undefined}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Link a repo owned by <span className="font-medium text-foreground">anyone</span> — public or
                    private. Cloning uses your computer&apos;s{" "}
                    <span className="font-medium text-foreground">local Git credentials</span>, so private repos
                    work only if your machine already has access.
                  </p>
                  <VerificationPanel id="github-url-verify-panel" malformed={isMalformed} verify={verify} />
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {mode === "create" && connection && (
            <Button onClick={handleCreate} disabled={isPending}>
              {isPending ? "Creating…" : "Create & link"}
            </Button>
          )}
          {mode === "manual" && (
            <Button onClick={handleManualSave} disabled={saveDisabled}>
              {isPending ? "Saving…" : saveLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectPrompt({ message, onConnect }: { message: string; onConnect: () => void }) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        {message} We&apos;ll request <code className="font-mono">repo</code> and{" "}
        <code className="font-mono">read:user</code> scopes. You can disconnect any time from Profile
        settings.
      </div>
      <Button onClick={onConnect} className="w-full gap-2">
        <Github className="h-4 w-4" />
        Connect GitHub
      </Button>
    </div>
  );
}

const STATE_PANEL_STYLES: Record<RepoAccessState, string> = {
  no_connection: "border-blue-500/25 bg-blue-500/5",
  ok_public: "border-emerald-500/25 bg-emerald-500/5",
  ok_private: "border-emerald-500/25 bg-emerald-500/5",
  not_found_or_no_access: "border-amber-500/25 bg-amber-500/5",
  unreachable: "border-border bg-muted/40",
};

const STATE_ICON_STYLES: Record<RepoAccessState, string> = {
  no_connection: "text-blue-500",
  ok_public: "text-emerald-500",
  ok_private: "text-emerald-500",
  not_found_or_no_access: "text-amber-500",
  unreachable: "text-muted-foreground",
};

function stateContent(state: RepoAccessState, owner: string, repo: string) {
  switch (state) {
    case "no_connection":
      return {
        Icon: Info,
        title: "Connect GitHub to verify repos",
        body: "We can't check a repo exists until you connect — but you can still link it now.",
      };
    case "ok_public":
      return {
        Icon: CheckCircle2,
        title: (
          <>
            Found <span className="font-mono text-foreground">{owner}/{repo}</span>
          </>
        ),
        body: (
          <span className="inline-flex items-center gap-1">
            <Globe className="h-3 w-3" /> Public repository on GitHub.
          </span>
        ),
      };
    case "ok_private":
      return {
        Icon: CheckCircle2,
        title: (
          <>
            Found <span className="font-mono text-foreground">{owner}/{repo}</span>
          </>
        ),
        body: (
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3" /> Private repository — visible to your GitHub account.
          </span>
        ),
      };
    case "not_found_or_no_access":
      return {
        Icon: AlertTriangle,
        title: (
          <>
            Couldn&apos;t find <span className="font-mono text-foreground">{owner}/{repo}</span> with your
            GitHub access
          </>
        ),
        body: "It may be a typo or not exist — or it's private and your GitHub token can't see it. You can still link it, and it'll clone fine if your computer has access.",
      };
    case "unreachable":
      return {
        Icon: CloudOff,
        title: "Couldn't verify right now",
        body: "GitHub didn't respond — you can still link it and verify later.",
      };
  }
}

function VerificationPanel({
  id,
  malformed,
  verify,
}: {
  id: string;
  malformed: boolean;
  verify: VerifyPanelState;
}) {
  if (malformed) {
    return (
      <div
        id={id}
        role="alert"
        aria-live="assertive"
        className="mt-2.5 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs"
      >
        <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
        <div>
          <div className="font-medium text-foreground">That&apos;s not a GitHub repo URL</div>
          <div className="text-muted-foreground mt-0.5">
            Expected <span className="font-mono text-foreground">https://github.com/owner/repo</span>.
          </div>
        </div>
      </div>
    );
  }

  if (verify.kind === "idle") return null;

  if (verify.kind === "checking") {
    return (
      <div
        id={id}
        role="status"
        aria-live="polite"
        className="mt-2.5 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        Checking repo…
      </div>
    );
  }

  const { state, owner, repo } = verify;
  const { Icon, title, body } = stateContent(state, owner, repo);

  return (
    <div
      id={id}
      role="status"
      aria-live="polite"
      className={`mt-2.5 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${STATE_PANEL_STYLES[state]}`}
    >
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${STATE_ICON_STYLES[state]}`} />
      <div>
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-muted-foreground mt-0.5">{body}</div>
      </div>
    </div>
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

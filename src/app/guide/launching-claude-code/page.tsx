import Link from "next/link";
import { SquareTerminal, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Launching Claude Code Guide",
  description:
    "Start Claude Code already wired to your board with one click — deep-link launch, project folder setup, copy-command fallback, and more on VibeCodes.",
};

export default function LaunchingClaudeCodePage() {
  return (
    <div>
      <Link
        href="/guide"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Guide
      </Link>

      <div className="mb-10 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <SquareTerminal className="h-6 w-6 text-emerald-400" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          Launching Claude Code
        </h1>
      </div>

      <div className="space-y-10">
        <section>
          <h2 className="mb-4 text-2xl font-semibold">Overview</h2>
          <p className="mb-4 text-muted-foreground">
            <strong className="text-foreground">Launch Claude Code</strong> is a
            one-click way to start Claude Code already wired to a board. The
            primary button — labelled{" "}
            <strong className="text-foreground">&quot;Launch Claude Code&quot;</strong>{" "}
            in the board toolbar — fires a{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              claude-cli://
            </code>{" "}
            deep link that opens Claude Code, connects the VibeCodes MCP server,
            and starts working the board.
          </p>
          <p className="text-muted-foreground">
            Instead of copying commands and explaining context by hand, one
            click hands Claude Code everything it needs: which project to open,
            how to connect, and which task to pick up first.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Where You Can Launch From</h2>
          <p className="mb-4 text-muted-foreground">
            There are several entry points throughout the app — wherever you
            are, launching Claude Code is close at hand:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Board toolbar</strong> — a
              split button:{" "}
              <strong className="text-foreground">&quot;Launch Claude Code&quot;</strong>{" "}
              plus a chevron that opens the{" "}
              <strong className="text-foreground">&quot;Launch options&quot;</strong>{" "}
              dropdown
            </li>
            <li>
              <strong className="text-foreground">Task card menu</strong> —{" "}
              <strong className="text-foreground">&quot;Launch in Claude Code&quot;</strong>
            </li>
            <li>
              <strong className="text-foreground">Task detail header</strong> — a
              terminal icon labelled{" "}
              <strong className="text-foreground">&quot;Launch in Claude Code&quot;</strong>
            </li>
            <li>
              <strong className="text-foreground">MCP connection banner</strong>
            </li>
            <li>
              <strong className="text-foreground">Dashboard setup checklist</strong>
            </li>
            <li>
              <strong className="text-foreground">Onboarding</strong>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">The Launch Options Dropdown</h2>
          <p className="mb-4 text-muted-foreground">
            The chevron next to the launch button opens a menu of options:
          </p>
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">&quot;Open in Claude Code&quot;</strong>{" "}
              — the standard launch
            </li>
            <li>
              <strong className="text-foreground">&quot;This machine&quot;</strong>{" "}
              — a line showing the saved folder path when one is set
            </li>
            <li>
              <strong className="text-foreground">&quot;Start a new project…&quot;</strong>
            </li>
            <li>
              <strong className="text-foreground">&quot;Copy launch command&quot;</strong>
            </li>
            <li>
              <strong className="text-foreground">&quot;Set exact folder (advanced)…&quot;</strong>
            </li>
            <li>
              <strong className="text-foreground">&quot;Install guide&quot;</strong>{" "}
              — links to{" "}
              <a
                href="https://docs.claude.com/en/docs/claude-code"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                docs.claude.com/en/docs/claude-code
              </a>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">What the Launch Actually Does</h2>
          <p className="mb-4 text-muted-foreground">
            The launch generates a prompt that tells Claude Code to do four
            things, in order:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Move into the project directory</strong>
            </li>
            <li>
              <strong className="text-foreground">Connect the{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                vibecodes
              </code>{" "}
              MCP server</strong>{" "}
              via Claude Code&apos;s built-in{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/mcp</code>{" "}
              sign-in flow — a human-in-the-loop OAuth handshake. It does{" "}
              <strong className="text-foreground">not</strong> hand-build URLs.
            </li>
            <li>
              <strong className="text-foreground">Record the project folder</strong>{" "}
              so future launches reopen it automatically
            </li>
            <li>
              <strong className="text-foreground">Pick up board work</strong>
            </li>
          </ul>
          <p className="text-muted-foreground">
            A board launch reads the board, takes the top unstarted task,
            assigns it, moves it to{" "}
            <strong className="text-foreground">In Progress</strong>, and if the
            task has a workflow it uses{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              claim_next_step
            </code>
            . Launching from a specific task targets that task instead of
            picking the top one.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Existing Folder vs New Project</h2>
          <p className="mb-4 text-muted-foreground">
            How Claude Code chooses where to work depends on your idea:
          </p>
          <ul className="mb-4 list-inside list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">If the idea has a GitHub repo</strong>{" "}
              — Claude Code opens or clones that repo automatically
            </li>
            <li>
              <strong className="text-foreground">If the idea has no repo</strong>{" "}
              — use{" "}
              <strong className="text-foreground">&quot;Start a new project…&quot;</strong>
              . The dialog (titled{" "}
              <strong className="text-foreground">&quot;Start a new project&quot;</strong>)
              lets you set a{" "}
              <strong className="text-foreground">&quot;New folder name&quot;</strong>{" "}
              and pick where to{" "}
              <strong className="text-foreground">&quot;Create it inside&quot;</strong>{" "}
              (defaults to{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                ~/projects
              </code>
              ). Claude Code runs{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">git init</code>{" "}
              (or{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">git clone</code>{" "}
              if a repo exists) when it launches.
            </li>
            <li>
              <strong className="text-foreground">&quot;Set exact folder (advanced)…&quot;</strong>{" "}
              — point Claude Code at an existing absolute path
            </li>
          </ul>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Important:</strong> the path
              must be a fully-expanded absolute path —{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">~</code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">$HOME</code>{" "}
              are <strong className="text-foreground">not</strong> supported.{" "}
              Tip: in your terminal,{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">cd</code>{" "}
              to the folder and run{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">pwd</code>{" "}
              — that prints the exact path to paste here.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Privacy of Your Folder Path</h2>
          <p className="mb-4 text-muted-foreground">
            The folder path you save is private to you. As the app states:
          </p>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">
                &quot;Stored on this device only — never shown to other
                collaborators.&quot;
              </strong>
            </p>
          </div>
          <p className="mt-4 text-muted-foreground">
            The path is saved in your browser&apos;s{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              localStorage
            </code>
            , per machine — so the{" "}
            <strong className="text-foreground">&quot;This machine&quot;</strong>{" "}
            line in the dropdown only ever reflects the device you are on.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Copy-Command Fallback</h2>
          <p className="mb-4 text-muted-foreground">
            Deep links are convenient but not bulletproof — the{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              claude-cli://
            </code>{" "}
            link can be blocked by the browser, or silently ignored if the
            generated OS URL is too long.
          </p>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              When that happens, use{" "}
              <strong className="text-foreground">&quot;Copy launch command&quot;</strong>
              . It copies the full command — you&apos;ll see the toast{" "}
              <strong className="text-foreground">
                &quot;Launch command copied — paste it in your terminal&quot;
              </strong>{" "}
              — and you paste it straight into your terminal. The copy fallback{" "}
              <strong className="text-foreground">always works</strong> and
              carries the full instructions, so reach for it any time the deep
              link doesn&apos;t open.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Desktop Only</h2>
          <div className="mb-4 rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              The{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                claude-cli://
              </code>{" "}
              scheme only works on{" "}
              <strong className="text-foreground">desktop</strong> where Claude
              Code is installed. On mobile the option is disabled and shows{" "}
              <strong className="text-foreground">
                &quot;Open on desktop to launch Claude Code&quot;
              </strong>
              .
            </p>
          </div>
          <p className="text-muted-foreground">
            You need Claude Code installed first. See the{" "}
            <Link
              href="/guide/mcp-integration"
              className="text-primary hover:underline"
            >
              MCP Integration guide
            </Link>{" "}
            for install and connection details.
          </p>
        </section>

        <section>
          <h2 className="mb-4 text-2xl font-semibold">Related Guides</h2>
          <div className="rounded-xl border border-border bg-muted/30 p-6">
            <p className="text-sm text-muted-foreground">
              To understand the underlying MCP connection that the launch sets
              up, read the{" "}
              <Link
                href="/guide/mcp-integration"
                className="text-primary hover:underline"
              >
                MCP Integration guide &rarr;
              </Link>{" "}
              And to learn what happens when the picked-up task has a workflow,
              see the{" "}
              <Link
                href="/guide/workflows"
                className="text-primary hover:underline"
              >
                Workflows guide &rarr;
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

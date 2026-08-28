#!/bin/sh
# Vercel "Ignored Build Step" script.
#
# Exit code 0  = SKIP the build (safe: every changed file is a non-shipping
#                file — docs, tests, CI config, etc.)
# Exit code 1  = RUN the build (default/safe fallback: something changed
#                that might affect the shipped app, or we couldn't tell)
#
# Vercel runs this from the repo root before each build. See:
# https://vercel.com/docs/projects/project-configuration#ignore-build-step

set -eu

# Get the list of files changed in the most recent commit. Prefer HEAD^,
# fall back to HEAD~1 (same commit, different syntax) for safety, and
# handle a shallow clone (only one commit available) without crashing.
DIFF_OUTPUT=""
if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  DIFF_OUTPUT=$(git diff --name-only HEAD^ HEAD 2>/dev/null) || DIFF_OUTPUT=""
elif git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
  DIFF_OUTPUT=$(git diff --name-only HEAD~1 HEAD 2>/dev/null) || DIFF_OUTPUT=""
else
  # Shallow clone with only one commit reachable — no prior commit to diff
  # against. We can't prove it's safe to skip, so build.
  echo "vercel-ignore: no previous commit available to diff against — building"
  exit 1
fi

if [ -z "$DIFF_OUTPUT" ]; then
  # Empty diff (or the diff command failed) — build, don't guess.
  echo "vercel-ignore: empty or unreadable diff — building"
  exit 1
fi

# Allow-list of path patterns that never affect the shipped app.
# Every changed file must match at least one of these for the build to
# be skipped.
match_allowlist() {
  file="$1"
  case "$file" in
    *.md) return 0 ;;
    docs/*) return 0 ;;
    .github/*) return 0 ;;
    e2e/*) return 0 ;;
    *.test.ts | *.test.tsx) return 0 ;;
    LICENSE) return 0 ;;
    *) return 1 ;;
  esac
}

all_matched=1
# Read the diff output via redirection (not a pipe) so this loop runs in
# the current shell — a `... | while read` loop runs in a subshell, and
# any variable set inside it (like all_matched below) would be lost the
# moment the loop exits.
while IFS= read -r changed_file; do
  [ -z "$changed_file" ] && continue
  if ! match_allowlist "$changed_file"; then
    echo "vercel-ignore: '$changed_file' is not on the allow-list — building"
    all_matched=0
    break
  fi
done <<EOF
$DIFF_OUTPUT
EOF

if [ "$all_matched" -eq 1 ]; then
  echo "vercel-ignore: all changed files are non-shipping — skipping build"
  exit 0
fi

exit 1

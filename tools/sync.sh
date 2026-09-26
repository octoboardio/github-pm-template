#!/bin/bash
# Sync one repository to the current template and merge it, but only if
# the destination's own checks pass.
#
# The previous version opened a pull request, waited eight seconds and
# admin-merged it whatever the result. That is how two failures stayed
# invisible for days: 03-pr-quality-gate failed on every sync because the
# branch had no linked issue, and 99-guards failed on repositories whose own
# workflows pin an action to @master. Both were merged over, five times.
#
# Usage:
#   sync.sh <repo> [--yes]
#     <repo>  owner/name, or a bare name resolved against ORG
#     --yes   merge without asking, once the checks are green
#
# Environment:
#   TEMPLATE_REPO    template repository to copy from, as owner/name (required)
#   ORG              organization a bare <repo> name belongs to
#   SYNC_TITLE       pull request title
#   SYNC_BODY_FILE   file holding the pull request body
#   SYNC_TIMEOUT     seconds to wait for checks (default 600)
set -uo pipefail

D="$(cd "$(dirname "$0")" && pwd)"
r="${1:?usage: sync.sh <repo> [--yes]}"
auto="${2:-}"
: "${TEMPLATE_REPO:?TEMPLATE_REPO is not set. Export it first, for example: export TEMPLATE_REPO=your-org/your-template-repo}"
case "$r" in
  */*) repo="$r" ;;
  *)   : "${ORG:?ORG is not set. Export it first, for example: export ORG=your-org}"
       repo="$ORG/$r" ;;
esac
branch="chore/adopt-pm-template"
timeout="${SYNC_TIMEOUT:-600}"

say() { printf '%-26s %s\n' "$r" "$*"; }

# A branch left over from a previous sync no longer shares history with the
# default branch once that sync is merged, and GitHub cannot compute a merge
# commit for a conflicting pull request, so its checks never run at all: the
# pull request sits looking untested rather than failing. Always start clean.
n=$(gh pr list --repo "$repo" --head "$branch" --json number --jq '.[0].number' 2>/dev/null)
[ -n "$n" ] && gh pr close "$n" --repo "$repo" >/dev/null 2>&1
gh api -X DELETE "repos/$repo/git/refs/heads/$branch" >/dev/null 2>&1

out=$(python3 "$D/fanout.py" "$repo" --apply 2>&1 | tail -1)
case "$out" in
  *"nothing to do"*) say "already in sync"; exit 0 ;;
  *"added"*|*"replaced"*) ;;
  *) say "fanout failed: $out"; exit 1 ;;
esac

title="${SYNC_TITLE:-chore: sync PM workflows and scripts from the PM template}"
if [ -n "${SYNC_BODY_FILE:-}" ] && [ -f "$SYNC_BODY_FILE" ]; then
  body=$(cat "$SYNC_BODY_FILE")
else
  # Describe this sync from the template's own history rather than a sentence
  # written once and left to go stale.
  body=$(printf '## Summary\n\n%s\n\nTemplate changes carried by this sync:\n\n%s\n\n## Type of Change\n- [x] chore: Maintenance / refactor\n\n## Testing\n- [x] Existing tests pass\n\nVerified in the template before release. `99-guards` on this pull request is the check that it holds here too.\n' \
    "Syncs \`$repo\` to the current state of \`$TEMPLATE_REPO\`. Files this repository owns (\`CODEOWNERS\`, \`dependabot.yml\`, the pull request template) are left alone, and so is any workflow the template does not ship." \
    "$(git -C "$D/.." log --oneline -8 --format='- %s')")
fi

base=$(gh api "repos/$repo" --jq .default_branch)
url=$(gh pr create --repo "$repo" --base "$base" --head "$branch" \
      --title "$title" --body "$body" 2>&1 | tail -1)
n="${url##*/}"
case "$n" in ''|*[!0-9]*) say "could not open a pull request: $url"; exit 1 ;; esac
say "opened #$n, waiting for checks"

# Wait for the checks to settle. A conflicting pull request never reports any,
# which is a state worth naming rather than merging through.
deadline=$((SECONDS + timeout))
while [ $SECONDS -lt $deadline ]; do
  pending=$(gh pr checks "$n" --repo "$repo" 2>/dev/null | grep -c pending)
  seen=$(gh pr checks "$n" --repo "$repo" 2>/dev/null | grep -c .)
  [ "$seen" -gt 0 ] && [ "$pending" -eq 0 ] && break
  sleep 15
done

checks=$(gh pr checks "$n" --repo "$repo" 2>/dev/null)
if [ -z "$checks" ]; then
  mergeable=$(gh pr view "$n" --repo "$repo" --json mergeable --jq .mergeable)
  say "#$n reported no checks (mergeable=$mergeable), left open"
  exit 1
fi
failed=$(printf '%s\n' "$checks" | awk '$2=="fail"{print $1}')
if [ -n "$failed" ]; then
  say "#$n FAILED: $(printf '%s' "$failed" | tr '\n' ' '), left open"
  exit 1
fi

if [ "$auto" != "--yes" ]; then
  say "#$n is green. Merge with: gh pr merge $n --repo $repo --squash --admin"
  exit 0
fi

gh pr merge "$n" --repo "$repo" --squash --admin >/dev/null 2>&1
say "#$n $(gh pr view "$n" --repo "$repo" --json state --jq .state)"

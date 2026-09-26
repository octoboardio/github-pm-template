# Agents

Prompt definitions for the AI assisted PM workflows. One file per agent.

Each agent is a markdown file named `<name>.agent.md` with YAML frontmatter
followed by the system prompt. The frontmatter is metadata for humans and
tooling; the workflow strips it before sending the body to the model.

| Key | Meaning |
|---|---|
| `name` | The agent's identifier, matching the filename |
| `description` | One or two sentences on what it does, including anything it may write |
| `used_by` | The workflow that sends this prompt |
| `advisory` | `true` when it can never fail a check or block a merge. Every agent here is advisory |
| `destructive` | `true` when it may close or hide something a person created. Only `milestone-tidy` is, and only for a milestone holding zero open issues. Applying a label or commenting is not destructive |
| `max_tokens` | An output cap, where the calling workflow enforces one |

## Labels the agents apply

Every label named in a prompt must exist in `.github/labels.json`, because
`gh` and the REST API look a label up by name and fail when it is absent. The
agents use `docs: missing`, `docs: verified`, `needs: refinement`,
`triage: still-relevant`, `triage: recommend-close` and
`triage: needs-rescope`. Adding a label to a prompt means adding it there too,
and `29-sync-labels.yml` then creates it on every repository.

| Agent | Used by | Purpose |
|-------|---------|---------|
| `size-assist.agent.md` | `.github/workflows/23-ai-size-assist.yml` | Sets a ticket's size when the field is empty, otherwise suggests one, and proposes a sub-issue breakdown when the ticket is XL |
| `backlog-triage.agent.md` | `.github/workflows/25-backlog-assistant.yml` | Reviews stale issues against the repository and recommends keep, close, or rescope. Manual trigger, capped batches, never closes anything |
| `docs-verify.agent.md` | `.github/workflows/26-docs-verify.yml` | Judges whether a pull request needed documentation and whether it got it, then reports what shipped back to the linked issue on merge |
| `ticket-refine.agent.md` | `.github/workflows/27-ticket-refine.yml` | Proposes a clearer version of a vague ticket with acceptance criteria. Silent when the ticket is already actionable |
| `milestone-tidy.agent.md` | `.github/workflows/28-milestone-tidy.yml` | Reviews open milestones, closes the ones with zero open issues, and otherwise recommends close, merge or keep |

## Editing an agent

Change the markdown body. No workflow change is needed. The next issue
opened or edited uses the new prompt.

## Providers

Two backends run the same agent definition. Pick one with the repository
variable `PM_AI_PROVIDER`.

| `PM_AI_PROVIDER` | Workflow | Backend | Cost |
|---|---|---|---|
| unset or anything but `claude` | `23-ai-size-assist.yml` | OpenRouter when `OPENROUTER_API_KEY` is set, otherwise GitHub Models | free tier on both |
| `claude` | `24-claude-size-agent.yml` | Claude Code Action, needs `CLAUDE_CODE_OAUTH_TOKEN` | uses your Claude subscription |

On the free path `PM_AI_MODEL` overrides the model. It defaults to
`google/gemma-4-31b-it:free` when `OPENROUTER_API_KEY` is set and
`openai/gpt-4o-mini` on GitHub Models, and is ignored when
`PM_AI_PROVIDER=claude`.

The free path makes a single inference call from the issue text. The Claude
path runs an agent with repository access, so it sizes against the real code
and generally produces a better breakdown. Neither requires a GitHub Copilot
seat.

Selecting `claude` without setting `CLAUDE_CODE_OAUTH_TOKEN` is safe: the
workflow logs and exits without doing anything.

## Enabling

Agents are on by default. Set the repository variable `PM_AI_ENABLED` to
`false` to turn them off for a repository.

The Claude backed agents additionally need `PM_AI_PROVIDER` set to `claude`
and a `CLAUDE_CODE_OAUTH_TOKEN` secret. Without that secret they log and exit
without acting, so selecting `claude` before the secret exists is safe.

Most agents only comment and label. Two may write more than that, in the
narrow case where nothing is overwritten. See "What the agents may write"
below. None of them blocks a merge or fails a check.

## Backlog Assistant

`25-backlog-assistant.yml` is manual only. Run it from the Actions tab with a
`limit` (default 10) and a `stale_days` threshold (default 60).

It reviews that many stale, untriaged issues, posts a verdict on each, applies
one of `triage: still-relevant`, `triage: recommend-close` or
`triage: needs-rescope`, and writes a summary to an issue titled
`🧹 Backlog triage log`. Re run it to continue through the backlog; issues it
has already seen are skipped.

It never closes anything. Closing is a human decision, done in bulk from the
`triage: recommend-close` label once you have read the recommendations.

It requires `PM_AI_PROVIDER=claude` and a `CLAUDE_CODE_OAUTH_TOKEN`, because
judging whether old work is still needed requires reading the repository.

## Docs Verify

`26-docs-verify.yml` runs on pull requests when `PM_AI_PROVIDER=claude`.

On open and on each push it reads the diff, decides whether the change
actually needs documentation, checks whether `_docs/` or `README.md` was
updated, and posts a sticky comment. It labels `docs: missing` or
`docs: verified`.

On merge it comments on the linked issue describing what really shipped
against what the ticket claimed, so a closed ticket is a truthful record
rather than a stale intention.

It complements `08-docs-gate.yml`, which only checks that an issue's
Documentation section is non empty. This one exercises judgement about
whether the documentation is real. It is advisory: it never fails a check
and never blocks a merge.

## Ticket Refine

`27-ticket-refine.yml` runs when an issue is opened, and can be run manually
against a specific issue number from the Actions tab.

It reads the issue and decides whether a competent engineer could pick it up
and know when it is done. If yes it says nothing. If not it posts one comment
proposing a better title, context, acceptance criteria, out of scope notes and
a size, then labels `needs: refinement`.

It never edits the ticket. The author accepts the proposal by copying it.

Staying quiet is the point. The oldest unfinished issues in this organisation
are titled things like "Documentation" and "Dev Support"; they were never
finished because they were never actionable. This agent exists to catch that
at creation, not to comment on every issue.

## Milestone Tidy

`28-milestone-tidy.yml` is manual only. Run it from the Actions tab.

It reviews every open milestone, gives each a verdict of keep, close, merge
or rename, and posts one report to an issue titled `📅 Milestone review`.

It closes a milestone only when it currently contains zero open issues.
Closing one that still holds open work would hide those issues from a view
somebody may rely on, so that case stays a human decision.

## What the agents may write

Most agents only comment. Two may write, and both are constrained to the
case where nothing is being overwritten.

| Agent | May write | Never |
|---|---|---|
| `size-assist` | Sets `Size` when the field is empty | Overwrite a size a person set |
| `milestone-tidy` | Closes milestones with zero open issues | Close a milestone holding open work, or delete one |

Everything else, `backlog-triage`, `docs-verify` and `ticket-refine`, posts a
comment and applies one of the labels above. None of them edits an issue,
closes anything, touches a project field, or changes a file.

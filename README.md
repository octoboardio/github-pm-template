<div align="center">

# GitHub PM Template

**Run project management in GitHub, with nothing else to buy or host.**

A complete GitHub-native PM setup in one template repository: issue forms,
a standard label set, a Kanban board standard, 30 automation workflows, and
AI agent definitions for sizing, refinement and triage.

[![Workflows](https://img.shields.io/badge/Workflows-30-2ea44f?style=flat-square&logo=githubactions)](https://github.com/octoboardio/github-pm-template/tree/main/.github/workflows)
[![License: MIT](https://img.shields.io/badge/License-MIT-0075ca?style=flat-square)](LICENSE)
[![Works with Octoboard](https://img.shields.io/badge/Works_with-Octoboard-6f42c1?style=flat-square)](https://octoboard.io)

</div>

---

## What you get

| Part | Where | What it does |
|---|---|---|
| Issue forms | `.github/ISSUE_TEMPLATE/` | Feature, Bug and Chore forms with Priority, Size and a Documentation section |
| Labels | `.github/labels.json` | 26 labels for priority, type, size, status, docs and triage, applied by a workflow |
| Board standard | `.github/board-standard.json` | 7 statuses, Priority, Size, dates and 5 views, provisioned and kept in line by a workflow |
| Automation | `.github/workflows/` | 30 workflows: triage, PR lifecycle, quality gates, WIP limits, size checks, flow report, security scans |
| AI agents | `.github/agents/` | Prompt files for size assist, ticket refinement, backlog triage, docs verification and milestone tidy |
| Fleet tools | `tools/` | Operator scripts that roll the template out to many repositories at once |

---

## Use this template

Create a repository from it:

```bash
gh repo create your-org/your-repo \
  --template octoboardio/github-pm-template \
  --private \
  --description "Your project board"
```

Or click **Use this template** on the repository page.

Two workflows do the rest:

| workflow | what it does on a brand new repository |
|---|---|
| `29-sync-labels` | creates the 26 labels in `.github/labels.json` |
| `30-sync-board`  | creates the org board named after the repository, links it, then applies `.github/board-standard.json`: the 7 statuses in order, `P0`-`P3` priority, `XS`-`XL` size, `Estimate` / `Start date` / `Target date` / `Client Ticket` / `Status entered`, and the 5 standard views |

Both are idempotent and both run weekly, so the worst a missed first run costs
is a board that turns up on Monday. To have it straight away, dispatch them
once after creating the repository:

```bash
gh workflow run 29-sync-labels.yml -R your-org/your-repo
gh workflow run 30-sync-board.yml  -R your-org/your-repo
```

Their push triggers are filtered to their own config files, and a repository
generated from a template does not reliably fire a push run at all, so treat
those two commands as part of creating the repository rather than as recovery.
Running them when the push already fired changes nothing.

Neither workflow deletes a status option or a label the repository added
itself. The one thing `30-sync-board` does remove is GitHub's built-in
`Priority` field, which holds no options and cannot be written through the API;
the `P0`-`P3` field from the standard takes its place. There is no manual board
setup step and no board id to paste anywhere: everything resolves the board by
title at run time.

**Opting out of a board.** A repository that deliberately has none (a demo, a
sandbox) sets a repository variable, otherwise the weekly run treats the
absence as drift and recreates it:

```bash
gh api -X POST repos/your-org/your-repo/actions/variables \
  -f name=PM_BOARD -f value=off
```

### Required secrets and variables

Nothing is needed for the basics: labels, issue forms, the PR quality gate, the
docs gate and the template checks all run on the default `GITHUB_TOKEN`.
Everything that touches the org project board needs `PROJECT_TOKEN`. Every
workflow that uses one of the secrets below checks for it and skips cleanly
when it is missing.

**Secrets**

| Secret | Needed? | Used by | Notes |
|---|---|---|---|
| `PROJECT_TOKEN` | Required for any board automation | 01, 02, 06, 11, 18 to 28, 30, 31, 32 | PAT with `repo` and `project` scopes. `GITHUB_TOKEN` cannot read organization projects. Without it, board steps fall back to `GITHUB_TOKEN` and `30-sync-board` logs why and exits cleanly. |
| `DEPENDABOT_TOKEN` | Optional | 09 | PAT with `repo` and pull request scope, used to approve Dependabot patch and minor PRs. Falls back to `GITHUB_TOKEN`, which works when Actions may approve PRs (see setup step 3). |
| `CLAUDE_CODE_OAUTH_TOKEN` | Optional, AI agent workflows only | 24, 25, 26, 27, 28 | Only read when `PM_AI_PROVIDER=claude`. Without it those workflows print a notice and skip. |
| `OPENROUTER_API_KEY` | Optional, AI agent workflows only | 23 | Free path for AI size assist. Without it, 23 uses GitHub Models through `GITHUB_TOKEN`. |

`GITHUB_TOKEN` is provided by GitHub Actions and needs no setup.

**Variables** (all optional, every one has a working default)

| Variable | Default | What it changes |
|---|---|---|
| `PM_RUNNER` | `ubuntu-latest` | The runner every workflow requests. Point it at a self-hosted runner pool to move all workflows there. A repository pointed at a pool it cannot reach queues its jobs indefinitely with no error, so leave this unset until the pool exists. |
| `PM_BOARD` | unset | `off` stops `30-sync-board` provisioning a board for this repository, and `31-flow-report` skips too. Without it the weekly run reads the absence as drift and recreates the board. |
| `PM_AI_ENABLED` | unset, meaning on | `false` turns every AI assisted workflow (23 to 28) off for this repository. |
| `PM_AI_PROVIDER` | unset | `claude` runs the agents through Claude Code Action, which reads the repository and needs `CLAUDE_CODE_OAUTH_TOKEN`. Anything else uses the free single-call path in `23-ai-size-assist`. Workflows 25 to 28 run only when this is `claude`. |
| `PM_AI_MODEL` | `google/gemma-4-31b-it:free` on OpenRouter, `openai/gpt-4o-mini` on GitHub Models | Overrides the model on the free path. Ignored when `PM_AI_PROVIDER=claude`. |
| `PM_CODEQL` | unset, meaning off on a private repository | `on` turns `12-codeql` back on. Code scanning on a private repository needs GitHub Code Security; without it the scan runs and then fails at the upload, so the workflow skips itself instead. Public repositories always scan. |
| `PM_DOCS_LINK` | unset, meaning on | `off` turns `32-done-gate` off, for a repository whose documentation lives somewhere the workflow cannot see. |

Secrets and variables are best set once at organization level (**Org Settings
→ Secrets and variables → Actions**) and shared with the repositories that need
them, so a new repository inherits them on creation. A single repository can
carry its own instead.

---

## Works with Octoboard

[Octoboard](https://octoboard.io) is a free delivery dashboard on top of GitHub
issues, pull requests, CI and deploys. The labels, sizes, statuses and the
blocked and ready signals this template standardizes are the same ones
Octoboard reads to build its **Risks**, **Review queue** and **Delivery**
views. Adopt the template and those views work without extra setup.

The template does not depend on Octoboard. Every workflow here runs on GitHub
alone.

---

## PM design

### Methodology

**Kanban**: continuous flow, no forced sprints. Work moves when it is ready.
WIP limits keep focus.

### Issue hierarchy

```
[EPIC] Large initiative
  └── feat/fix/chore: Individual unit of work   ← PR closes this
        └── Sub-issue (native GitHub sub-issue, for parallel work)
```

### Kanban columns

```
Backlog → Ready → In Progress → Blocked → In Review → Client Awaiting → Done
```

| Column | Definition | WIP limit |
|--------|-----------|-----------|
| **Backlog** | Captured, not yet refined | none |
| **Ready** | Has acceptance criteria, priority, size and target date. Pick up immediately | none |
| **In Progress** | Actively being worked on | **2 per person** |
| **Blocked** | Cannot proceed, reason must be in comments | target 0 |
| **In Review** | PR open, awaiting review | **3 per person** |
| **Client Awaiting** | Waiting on the client or another outside party (sign off, access, an answer) | target 0 |
| **Done** | Merged and closed | none |

Teams that do not work for outside clients can read **Client Awaiting** as
"waiting on someone outside the team". It is tracked separately from Blocked so
the flow report can show who is holding the work.

### Project fields

| Field | Values |
|-------|--------|
| **Status** | Backlog · Ready · In Progress · Blocked · In Review · Client Awaiting · Done |
| **Priority** | P0: Critical · P1: High · P2: Medium · P3: Low |
| **Size** | XS · S · M · L · XL |
| **Estimate** | Number |
| **Start date** / **Target date** | Date |
| **Client Ticket** | External reference (Jira, Linear, a helpdesk, and so on) |
| **Status entered** | Date, written by the workflows (see "How flow is measured") |

> **Issue Type** is not a project field. It is a native org level issue type
> (Epic, Feature, Bug, Chore, Task), set on the issue itself.

---

## Label system

### Priority

| Label | Meaning |
|-------|---------|
| `P0: critical` | Production down, data loss or security breach. Drop everything |
| `P1: high` | Significant impact, must be in current flow |
| `P2: medium` | Important but not urgent |
| `P3: low` | Nice to have |

### Type
`type: epic` · `type: feature` · `type: bug` · `type: chore` · `type: sub-task` · `type: question`

### Size
`size: XS` (under 1h) · `size: S` (half a day) · `size: M` (1 to 2 days) · `size: L` (3 to 5 days) · `size: XL` (over 5 days, break it down)

### Status
`status: blocked` · `status: needs-review` · `status: stale` · `status: wontfix`

### Documentation

| Label | Meaning |
|-------|---------|
| `docs: missing` | Documentation section blank, blocked from moving to Ready |
| `docs: bypassed` | Explicitly bypassed with a written reason, audit trail kept |
| `docs: verified` | The docs verify agent confirmed the change got the docs it needed |

### Refinement and triage (applied by the AI agents)
`needs: refinement` · `triage: still-relevant` · `triage: recommend-close` · `triage: needs-rescope`

---

## Ticket sizing

Size is set on the board, not by label. It is enforced, not advisory.

| Size | Budget | Meaning |
|------|--------|---------|
| `XS` | under 1h | One line change, config tweak |
| `S`  | half a day | Single file, no new interface |
| `M`  | 1 to 2 days | Normal unit of work |
| `L`  | 3 to 5 days | Large, prefer splitting |
| `XL` | over 5 days | **Cannot enter Ready.** Split into 2 or more sub-issues. |

**What enforces this**

| Workflow | Rule | Effect |
|---|---|---|
| `18-ready-gate` | No Ready without Size, Priority and Target date | Comments what is missing |
| `19-size-guard` | XL needs 2 or more sub-issues | Blocks until split |
| `20-size-drift` | Time In Progress over the size budget | Nudges once per size value |
| `21-size-calibration` | Weekly Size against actual PR diff | Reports accuracy |

Gates apply to newly opened and newly edited issues. The existing backlog is
never retroactively blocked.

---

## Issue templates

Three structured YAML forms with dropdowns, so Priority and Size are always
valid values.

| Template | Default labels |
|----------|---------------|
| **Feature** | `type: feature` · `P2: medium` · `docs: missing` |
| **Bug** | `type: bug` · `P1: high` · `docs: missing` |
| **Chore** | `type: chore` · `P3: low` · `docs: missing` |

### Issue naming conventions

| Level | Format | Example |
|-------|--------|---------|
| Epic | `[EPIC] <Initiative>` | `[EPIC] Kubernetes 1.31 upgrade` |
| Feature | `feat: <description>` | `feat: enforce pod security standards` |
| Bug | `fix: <description>` | `fix: nodes not draining on rolling update` |
| Chore | `chore: <description>` | `chore: upgrade monitoring stack` |

Sub-issues use GitHub's native sub-issue feature (linked via the Sub-issues
panel on the parent issue), not a title prefix. The title convention above
applies only to `feat:`, `fix:`, `chore:`, and `[EPIC]`.

### PR to issue lifecycle

```
PR title:  feat: enforce pod security standards (#7)
PR body:   Closes #7
           ↓ on merge
Issue #7 moves to Done
```

---

## Documentation gate

Every issue **must** have `## Documentation` filled before moving to Ready.

**To bypass** (when no docs are needed), post a comment on the issue:

```
/bypass-docs: Internal refactor, no user-facing changes
```

- The reason must be at least 10 characters
- `docs: bypassed` is added as an audit trail
- Epics are exempt

---

## GitHub Actions workflows

30 workflows. The numbers are stable identifiers, so gaps in the sequence are
expected.

| # | Workflow | Trigger | What it does |
|---|----------|---------|--------------|
| 01 | **Auto Triage** | Issue opened | Labels by title prefix · adds to board · posts checklist |
| 02 | **PR Lifecycle** | PR opened/merged | Moves linked issue to In Review, then Done |
| 03 | **PR Quality Gate** | PR opened/edited | Enforces title convention · linked issue · branch naming |
| 04 | **Blocked Reminder** | Weekdays 9am UTC | Pings assignee if stuck in Blocked over 2 days |
| 05 | **Stale Cleanup** | Every Monday | Labels stale after 60 days, never closes |
| 06 | **WIP Guard** | Issue assigned | Warns if assignee has more than 2 In Progress items |
| 07 | **Release Drafter** | Push to main | Drafts a changelog grouped by label |
| 08 | **Docs Gate** | Issue opened/edited/commented | Enforces the Documentation section · handles `/bypass-docs:` |
| 09 | **Dependabot Auto-merge** | PR opened (Dependabot) | Auto-merges patch/minor · flags major for human review |
| 10 | **PR Size Labeler** | PR opened/sync | Labels PR `size: XS-XL` · warns on XL |
| 11 | **Daily Board Digest** | 8:30am UTC weekdays | Posts board summary: blocked, stale reviews, WIP |
| 12 | **CodeQL** | Push/PR + weekly | Detects languages present in the repo, scans only those. Skips on a private repo without Code Security, see `PM_CODEQL` |
| 13 | **Auto Milestone** | Issue labeled | Assigns milestone based on Priority + Type |
| 14 | **IaC Security Scan** | Push (IaC paths) | tfsec / hadolint on Terraform, Docker, k8s manifests |
| 18 | **Ready Gate** | Issue opened/edited/labeled/reopened | Blocks Ready without Size, Priority and Target date |
| 19 | **Size Guard** | Issue opened/edited/labeled/reopened/assigned | Blocks `XL` without 2 or more sub-issues |
| 20 | **Size Drift** | Weekdays 7am UTC | Nudges issues In Progress past their size budget |
| 21 | **Size Calibration** | Every Monday | Reports Size accuracy against actual PR diff |
| 22 | **Mark In Progress** | Issue assigned/labeled/edited/reopened | Moves issue to In Progress when work starts |
| 23 | **AI Size Assist** | Issue opened/edited | Suggests a size on the free path, sets it when the field is empty |
| 24 | **Claude Size Agent** | Issue opened/edited | The same, through Claude Code Action, sized against the real code |
| 25 | **Backlog Assistant** | Manual | Triages stale issues, labels `triage: *`, never closes |
| 26 | **Docs Verify** | PR opened/sync/merged | Judges whether the change needed docs and whether it got them |
| 27 | **Ticket Refine** | Issue opened / manual | Proposes acceptance criteria for a ticket nobody could act on |
| 28 | **Milestone Tidy** | Manual | Reviews milestones, closes only the ones holding zero open issues |
| 29 | **Sync Labels** | `labels.json` change · weekly | Applies the 26 labels to the repository |
| 30 | **Sync Project Board** | `board-standard.json` change · weekly | Provisions the board, links it, aligns fields and views |
| 31 | **Flow Report** | Every Monday · manual | Cycle time, throughput, ageing work, and how long the client has held each item |
| 32 | **Done Gate** | Issue closed | Requires a documentation link, moves undocumented work back off the done column |
| 99 | **Template Guards** | Push to main / PR | actionlint, unit tests, and the label / board / inline-script checks |

### The two gates

Both ask at the moment their answer can be true, which is why neither lives on
the issue form.

**Ready needs a Target date**, alongside Size and Priority. Ready means
committed, and a commitment with no date is not one. Asked at creation it is a
date somebody invents to get past the form. A Target date that has already
passed is not refused, it is pointed out.

**Done needs a documentation link.** You cannot link a document that has not
been written, so this runs on close, not at creation. It reads the
`## Documentation` section, then the body, then the whole thread, and takes the
first link that is not a badge and not a pull request, issue or commit in this
repository, because those are evidence of the work rather than documentation of
it. Without one it labels `docs: missing`, says what it wants, and moves the
item back out of the done column: the issue stays closed, but undocumented work
is not counted as delivered by the flow report. Posting the link later clears
it. `docs: bypassed`, `type: epic` and `status: wontfix` are exempt, and
`/bypass-docs: <reason>` still works.

The link is checked for shape and never fetched. Most team documentation sits
behind authentication, so a liveness check would fail on exactly the links that
matter and pass on the ones that do not.

### How flow is measured

The ProjectV2 API keeps no status history: an item tells you where it is, never
how long it has been there. So the workflows that move items write it down.

| Field | Written by | Meaning |
|---|---|---|
| `Status entered` | `02-pr-lifecycle`, `22-mark-in-progress`, on every move | When the item arrived where it is now |
| `Start date` | the same, once, on first entry to In Progress | When work actually began, never overwritten |

`Status entered` gives time in the current status, which is what makes the
client queue measurable. The two together give cycle time on delivery. An item
that goes In Progress, Blocked, In Progress again keeps its original start, so a
round trip through Blocked does not flatter the number.

Which column means what is named in the `flow` block of
`.github/board-standard.json`, not spelled inside a workflow, so renaming a
column on the board does not silently stop the measurement. `99-guards` fails
if that block names a status the board does not have.

`99-guards` runs in every repository that adopts this template, so it draws a
line: the numbered workflows (`01-` to `32-`, `99-`) are the template's and a
finding in one fails the build. Any other workflow in `.github/workflows` is
that repository's own CI, and a finding there is printed as a notice and
nothing more. How another team pins an action in their deploy workflow is not
this template's decision.

---

## Branch protection (recommended)

Protect `main` with a GitHub ruleset:

- PRs required before merging
- 1 approving review required
- CODEOWNERS review required for infra and workflow files
- Stale reviews dismissed on new push
- All review threads must be resolved before merge
- Force push blocked
- Branch deletion blocked
- Dependabot patch/minor auto-merge allowed when CI is green

---

## External integrations

| Tool | Purpose | How linked |
|------|---------|------------|
| **Jira / helpdesk** | Service desk or client tickets | `Client Ticket` field + issue body |
| **Time tracking** | Hours against a project | `Client Ticket` field |
| **Linear / other** | Any external PM tool | `Client Ticket` field |
| **[Octoboard](https://octoboard.io)** | Delivery dashboards | Reads the labels, statuses and sizes this template sets |

All engineering PM lives in GitHub. External tools link in through the
`Client Ticket` field rather than holding the work themselves.

---

## Suggested first ticket: project onboarding

Open one ticket that covers everything needed before engineering work begins,
so onboarding is auditable in one place.

### `chore: project onboarding, provision all team access and tools`

> Labels: `type: chore` · `P1: high`
> Size: `M` · Status: **Ready** · Milestone: `v1.0`

```
### Secrets and credentials
- [ ] Create a shared vault for the project and share it with the team
- [ ] Store initial credentials

### Time tracking
- [ ] Create the project, add all team members

### Chat
- [ ] Create a project channel, invite the team (and client, if any)
- [ ] Pin the project board link in the channel

### GitHub
- [ ] Confirm repo + project board created
- [ ] Team access set, CODEOWNERS updated

### Cloud platform
- [ ] IAM / SSO provisioned, MFA enforced

### Verification
- [ ] Every team member logged in to all tools
- [ ] Kickoff scheduled
- [ ] Board link shared with stakeholders: <BOARD_URL>
```

---

## Milestones and releases

Milestones map to delivery targets. Issues are assigned by `13-auto-milestone`
when labeled. An example set:

| Milestone | Scope |
|-----------|-------|
| `v1.0: Platform Hardening` | Cluster upgrade, pod security, network policies, resource quotas |
| `v1.1: Observability Stack` | Metrics, dashboards, logs, traces, alerting |
| `v1.2: CI/CD Standardisation` | Reusable workflows, image scanning, canary deployments |

Releases are drafted on every merge to `main` by Release Drafter, with the
changelog grouped by `type:` label.

---

## Daily standup template

Share this with the team at kickoff. Each person posts in chat using this
format, no meeting needed.

```
Standup: <Date>

Yesterday
- ...

Today
- ...

Blockers
- None / <description + link to blocked issue>

My tickets: <BOARD_URL>?filterBy=assignee:<github-username>
```

> **Board link:** `https://github.com/orgs/your-org/projects/<number>`
>
> Filter by assignee to share your personal view:
> `https://github.com/orgs/your-org/projects/<number>?filterBy=assignee%3A<your-github-username>`

### Rules
- Post by **10am local time** (or a team-agreed time)
- If blocked, open or update a GitHub issue with the `status: blocked` label **the same day**
- If nothing to report, post `No updates, on leave / no changes`

---

## Repo structure

```
.github/
├── CODEOWNERS                      # Commented example, set your own team
├── ISSUE_TEMPLATE/
│   ├── feature.yml                 # Structured form: Feature
│   ├── bug.yml                     # Structured form: Bug
│   ├── chore.yml                   # Structured form: Chore
│   └── config.yml                  # Disable blank issues, contact link
├── pull_request_template.md        # Standard PR checklist
├── dependabot.yml                  # Auto-updates: Actions, Docker, pip, Terraform
├── release-drafter.yml             # Changelog config
├── labels.json                     # The label set, applied by 29-sync-labels
├── board-standard.json             # The board: statuses, fields, views, synonyms
├── actions/
│   └── pm-resolve/                 # Resolves the board and its field ids by title
├── agents/                         # Prompt definitions for the AI assisted workflows
│   ├── size-assist.agent.md
│   ├── backlog-triage.agent.md
│   ├── docs-verify.agent.md
│   ├── ticket-refine.agent.md
│   └── milestone-tidy.agent.md
├── scripts/                        # Workflow logic that is too large to inline
│   ├── board-vocab.js              # The one reader of board-standard.json
│   ├── board-plan.js               # Pure option-list planning, unit tested
│   ├── board-plan.test.js
│   ├── flow-metrics.js             # Pure cycle time and ageing maths
│   ├── flow-metrics.test.js
│   ├── flow-report.js              # Drives 31-flow-report
│   ├── stamp-status.js             # Records when an item changed status
│   ├── doc-link.js                 # Pure documentation link detection
│   ├── doc-link.test.js
│   ├── done-gate.js                # Drives 32-done-gate
│   ├── done-gate.test.js
│   ├── sync-board.js               # Drives 30-sync-board
│   ├── sync-labels.js              # Drives 29-sync-labels
│   └── check-template.py           # Drives the template checks in 99-guards
└── workflows/
    ├── 01-auto-triage.yml
    ├── 02-pr-lifecycle.yml
    ├── 03-pr-quality-gate.yml
    ├── 04-blocked-reminder.yml
    ├── 05-stale.yml
    ├── 06-wip-guard.yml
    ├── 07-release-drafter.yml
    ├── 08-docs-gate.yml
    ├── 09-dependabot-automerge.yml
    ├── 10-pr-size-labeler.yml
    ├── 11-daily-digest.yml
    ├── 12-codeql.yml
    ├── 13-auto-milestone.yml
    ├── 14-iac-scan.yml
    ├── 18-ready-gate.yml
    ├── 19-size-guard.yml
    ├── 20-size-drift.yml
    ├── 21-size-calibration.yml
    ├── 22-mark-in-progress.yml
    ├── 23-ai-size-assist.yml
    ├── 24-claude-size-agent.yml
    ├── 25-backlog-assistant.yml
    ├── 26-docs-verify.yml
    ├── 27-ticket-refine.yml
    ├── 28-milestone-tidy.yml
    ├── 29-sync-labels.yml          # Applies labels.json
    ├── 30-sync-board.yml           # Applies board-standard.json
    ├── 31-flow-report.yml          # Weekly cycle time and client queue
    ├── 32-done-gate.yml            # Requires a documentation link at close
    └── 99-guards.yml               # Lints and checks the template itself
tools/                              # Fleet scripts, see tools/README.md
```

---

## One-time setup (per repo)

After creating a repo from this template, complete these steps before the
workflows are fully operational.

### 1. Add secrets and variables

See [Required secrets and variables](#required-secrets-and-variables). At
minimum, add `PROJECT_TOKEN` so the board workflows can run.

> **Create a PAT:** GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens

### 2. Allow GitHub Actions to approve PRs

> **Org Settings → Actions → General → Workflow permissions**

- Set to **"Read and write permissions"**
- Check **"Allow GitHub Actions to create and approve pull requests"**

Without this (and without `DEPENDABOT_TOKEN`), Dependabot auto-merge will
comment on major PRs but cannot approve patch/minor ones.

### 3. Enable Dependabot and secret scanning (recommended)

> **Repo Settings → Security → Enable all**

- Dependency graph
- Dependabot alerts
- Dependabot security updates
- Secret scanning
- Push protection

### 4. Set your CODEOWNERS team

`.github/CODEOWNERS` ships as a commented example. Replace
`@your-org/maintainers` with a real team in your organization and uncomment the
lines you want:

```
*   @your-org/your-team
```

### 5. Board resolution (no manual ID needed)

There is nothing to hardcode. `.github/actions/pm-resolve` resolves the
ProjectV2 board, its fields, and its single-select option ids by title at
runtime, so no workflow ever stores a project ID.

The only requirement: the GitHub Project board has exactly the same name as the
repository. `30-sync-board` creates it that way.

---

## Rolling out to many repositories

`tools/` holds operator scripts that copy this template into existing
repositories and align their boards. They read the organization from the `ORG`
environment variable and the template from `TEMPLATE_REPO`. See
[tools/README.md](tools/README.md).

---

## Quick reference

```bash
# Create a feature issue
gh issue create --repo your-org/your-repo \
  --title "feat: <description>" \
  --label "type: feature,P2: medium"

# Bypass the docs gate: post this as an issue comment
/bypass-docs: <reason>

# Re-apply labels and the board standard
gh workflow run 29-sync-labels.yml -R your-org/your-repo
gh workflow run 30-sync-board.yml  -R your-org/your-repo
```

---

## License

[MIT](LICENSE)

<div align="center">

Maintained by [Octoboard](https://octoboard.io). Originally built at CloudDrove.

</div>

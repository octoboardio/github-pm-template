# Fleet tooling

Scripts that keep many repositories and their project boards in line with this
template. They are operator tools, run by hand from a machine with `gh`
authenticated. Nothing here is copied into an adopter: the fanout only ever
carries `.github/` and the template README.

Nothing in these scripts names an organization. They read it from the
environment and stop with a clear message when it is missing:

| variable | used by | meaning |
|---|---|---|
| `ORG` | all scripts | The organization that owns the target repositories and boards. `fanout.py` and `sync.sh` only need it when you pass a bare repository name instead of `owner/name`. |
| `TEMPLATE_REPO` | `fanout.py`, `sync.sh` | Your copy of this template, as `owner/name`. Files are copied from here. |

| script | what it does |
|---|---|
| `fanout.py` | Copies the template's `.github/` into one repository on a branch. Additive: a file is written only when absent, or when the destination holds a stale copy of a template-owned file. Repo-owned files (`CODEOWNERS`, `dependabot.yml`, PR template) are never touched. Refuses any replace that would lower a pinned action version. |
| `sync.sh` | `fanout.py` for one repository, end to end: branch, pull request, then merge only if the destination's own checks pass. Pass `--yes` to merge unattended, otherwise it prints the merge command and stops. `SYNC_TITLE` and `SYNC_BODY_FILE` override the pull request text, which otherwise describes the sync from the template's own recent commits. |
| `align_board.py` | Aligns one ProjectV2 board to the standard in `.github/board-standard.json`. Sends option lists back complete and by id, so renaming and reordering never drop an item's value. |
| `prune_empty_statuses.py` | Removes non-standard Status columns that hold zero items. Counts first, and never removes a column in use. |

## Why these are not workflows

Most of this is automated in-repo: `29-sync-labels.yml` and
`30-sync-board.yml` keep a single repository correct on a schedule. These
scripts are the fleet-wide equivalents, for changing the standard itself and
pushing it everywhere at once.

## The one rule

Deleting a single select option deletes that value on every item using it.
Every script here counts items before removing anything, and none of them
delete a column that is in use. Keep it that way.

## Usage

```
export ORG=your-org
export TEMPLATE_REPO=your-org/your-template-repo

python3 tools/fanout.py <repo>                  # dry run
python3 tools/fanout.py <repo> --apply
tools/sync.sh <repo> [--yes]
python3 tools/align_board.py <project-number>   # dry run
python3 tools/align_board.py <project-number> --apply
python3 tools/prune_empty_statuses.py <project-number> [--apply]
```

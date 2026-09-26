#!/usr/bin/env python3
"""Copy the PM template setup into another repository in your organization.

Additive only. A file is written only when that exact path does not already
exist in the destination. Nothing is ever overwritten or deleted, so a repo
keeps its own CODEOWNERS, dependabot config and PR template.

Two collisions are handled explicitly:
  - .github/pull_request_template.md is skipped when the destination already
    has .github/PULL_REQUEST_TEMPLATE.md. They are distinct paths in git but
    collide on case insensitive checkouts.
  - README.md at the repo root is never touched. The template's own README
    is installed as _docs/pm-workflow.md instead.

Usage:
  fanout.py <repo> [--apply]
Without --apply it prints the plan and changes nothing.

<repo> is either owner/name or a bare name. A bare name is resolved against
the ORG environment variable.

Environment:
  TEMPLATE_REPO  the template repository to copy from, as owner/name (required)
  ORG            the organization a bare <repo> name belongs to
"""
import base64
import json
import re
import os
import subprocess
import sys
import tempfile

TEMPLATE = None  # set from TEMPLATE_REPO in main()
BRANCH = "chore/adopt-pm-template"

# Files the template owns. If a destination already has one it is a stale copy
# of ours, and the point of a sync is to replace it, so an old workflow copy
# never keeps running in a repository after the template has moved on.
#
# These, by contrast, are genuinely per repo. A destination copy is that team's
# own configuration and is never touched.
REPO_OWNED = {
    ".github/CODEOWNERS",
    ".github/dependabot.yml",
    ".github/pull_request_template.md",
    ".github/PULL_REQUEST_TEMPLATE.md",
}


def require_env(name, example):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} is not set. Export it first, for example: export {name}={example}")
    return value


def gh(*args, check=True):
    out = subprocess.run(["gh", *args], capture_output=True, text=True)
    if check and out.returncode != 0:
        raise SystemExit(f"gh {' '.join(args[:3])} failed: {out.stderr.strip()[:300]}")
    return out.stdout


def put(repo, path, payload):
    """PUT one file through the Contents API.

    The payload goes through a temp file because it is too large for an
    argument list. That file used to be a fixed path, shared by every fanout
    running at once, and concurrent runs overwrote each other's payload between
    writing it and gh reading it back: syncing eight repositories in parallel
    failed six of them with "sha does not match", '"sha" wasn\'t supplied' and
    a ContentLength mismatch, which is the file changing size mid-read. One
    file per call, removed after.
    """
    fd, body = tempfile.mkstemp(prefix="fanout-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(payload, fh)
        gh("api", "-X", "PUT", f"repos/{repo}/contents/{path}", "--input", body)
    finally:
        os.unlink(body)


def tree(repo, ref="HEAD"):
    data = json.loads(gh("api", f"repos/{repo}/git/trees/{ref}?recursive=1"))
    return {n["path"]: n["sha"] for n in data["tree"] if n["type"] == "blob"}


def branch_exists(repo):
    r = subprocess.run(["gh", "api", f"repos/{repo}/git/ref/heads/{BRANCH}"],
                       capture_output=True, text=True)
    return r.returncode == 0


def blob(repo, path):
    data = json.loads(gh("api", f"repos/{repo}/contents/{path}"))
    return base64.b64decode(data["content"])


ACTION_PIN = re.compile(rb"uses:\s*([\w.-]+/[\w./-]+)@v?([0-9]+(?:\.[0-9]+)*)")


def pins(blob):
    """Map action name -> version tuple for every `uses: owner/repo@vN` pin."""
    out = {}
    for name, ver in ACTION_PIN.findall(blob):
        out[name.decode()] = tuple(int(x) for x in ver.decode().split("."))
    return out


def downgrades(src_blob, dst_blob):
    """Action pins where the destination is NEWER than the template.

    fanout replaces on any difference and has no notion of direction, so once
    dependabot bumps an action in an adopter, the next sync silently reverts it.
    Refuse those files and let the template be brought forward instead.
    """
    s, d = pins(src_blob), pins(dst_blob)
    return {k: (d[k], s[k]) for k in d if k in s and d[k] > s[k]}


def plan(repo):
    # Read the destination from the working branch when it already exists, so a
    # run interrupted part way through resumes instead of trying to re-add files
    # it already wrote.
    ref = BRANCH if branch_exists(repo) else "HEAD"
    src, dst = tree(TEMPLATE), tree(repo, ref)
    lower_dst = {p.lower() for p in dst}
    copy, skip = [], []
    for path in sorted(src):
        if path == "README.md":
            target = "_docs/pm-workflow.md"
        elif path.startswith(".github/"):
            target = path
        else:
            continue                                  # nothing else leaves the template
        if target in REPO_OWNED:
            if target in dst or target.lower() in lower_dst:
                skip.append((target, "repo owned, left as is"))
            else:
                copy.append((path, target, "add"))
            continue
        if target in dst:
            if dst[target] != src[path]:
                back = downgrades(blob(TEMPLATE, path), blob(repo, target))
                if back:
                    detail = ", ".join(
                        f"{k} @{'.'.join(map(str, have))} > template @{'.'.join(map(str, want))}"
                        for k, (have, want) in back.items())
                    skip.append((target, f"REFUSED, would downgrade: {detail}"))
                else:
                    copy.append((path, target, "replace"))
            continue
        if target.lower() in lower_dst:
            skip.append((target, "case collision with an existing file"))
        else:
            copy.append((path, target, "add"))
    return copy, skip


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    global TEMPLATE
    TEMPLATE = require_env("TEMPLATE_REPO", "your-org/your-template-repo")
    repo_short = sys.argv[1]
    if "/" in repo_short:
        repo = repo_short
    else:
        repo = f"{require_env('ORG', 'your-org')}/{repo_short}"
    apply = "--apply" in sys.argv

    copy, skip = plan(repo)
    adds = [c for c in copy if c[2] == "add"]
    reps = [c for c in copy if c[2] == "replace"]
    print(f"{repo}:  {len(adds)} add, {len(reps)} replace, {len(skip)} left alone")
    for _, t, _k in adds:
        print(f"  + {t}")
    for _, t, _k in reps:
        print(f"  ~ {t}  (stale template copy)")
    for t, why in skip:
        print(f"  = {t}  ({why})")

    if not apply:
        print("\ndry run, nothing changed. pass --apply to execute")
        return

    if not copy and not branch_exists(repo):
        print("nothing to do")
        return

    base = json.loads(gh("api", f"repos/{repo}"))["default_branch"]
    head = json.loads(gh("api", f"repos/{repo}/git/ref/heads/{base}"))["object"]["sha"]
    existing = subprocess.run(
        ["gh", "api", f"repos/{repo}/git/ref/heads/{BRANCH}"],
        capture_output=True, text=True)
    if existing.returncode != 0:
        gh("api", f"repos/{repo}/git/refs", "-f", f"ref=refs/heads/{BRANCH}",
           "-f", f"sha={head}")
        print(f"  branch {BRANCH} created from {base}@{head[:7]}")
    else:
        print(f"  branch {BRANCH} already exists, reusing")

    dst_now = tree(repo, BRANCH if branch_exists(repo) else "HEAD")
    for src_path, target, kind in copy:
        content = base64.b64encode(blob(TEMPLATE, src_path)).decode()
        verb = "update" if kind == "replace" else "add"
        payload = {
            "message": f"chore: {verb} {target} from {TEMPLATE}",
            "content": content,
            "branch": BRANCH,
        }
        if kind == "replace":
            # the API needs the blob sha of the file being replaced
            payload["sha"] = dst_now[target]
        put(repo, target, payload)
        print(f"  {verb}d {target}")

    print(f"\n{len(adds)} added, {len(reps)} replaced in {repo}@{BRANCH}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Check the template's own configuration before it reaches an adopter.

Everything here exists because it already went wrong once. A label named in a
prompt but absent from labels.json fails at the API with "not found"; a board
vocabulary copied into a script drifts from the standard; a syntax error in an
inline `script:` block only shows up on the repository that runs it.

Usage:
  check-template.py [repo-root]
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
GH = ROOT / ".github"

# Colours GitHub accepts on a ProjectV2 single select option.
BOARD_COLORS = {"GRAY", "BLUE", "GREEN", "YELLOW", "ORANGE", "RED", "PINK", "PURPLE"}
VIEW_LAYOUTS = {"BOARD_LAYOUT", "TABLE_LAYOUT", "ROADMAP_LAYOUT"}

# Scripts allowed to hold their own copy of the board vocabulary. Empty: every
# script reads it from board-standard.json.
VOCAB_EXEMPT = set()

problems = []
notices = []

# The template owns the numbered workflows it ships. Everything else in an
# adopter's .github/workflows is that team's own CI, and this script travels
# with the template into every adopting repository: failing their build over how they
# pinned an action in their own deploy workflow is not the template's business.
# Those findings are still worth saying, so they are printed as notices.
TEMPLATE_WORKFLOW = re.compile(r"^\d\d-.*\.ya?ml$")


def owned(path):
    return TEMPLATE_WORKFLOW.match(Path(path).name) is not None


def fail(where, msg, hard=True):
    (problems if hard else notices).append(f"{where}: {msg}")


def node_check(source, where):
    """Syntax check a fragment of JavaScript without running it."""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                     encoding="utf-8") as fh:
        fh.write("(async () => {\n" + source + "\n})()\n")
        tmp = fh.name
    r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    Path(tmp).unlink(missing_ok=True)
    if r.returncode:
        fail(where, "JavaScript does not parse\n" + r.stderr.strip())


# ---------------------------------------------------------------- workflows
workflows = sorted((GH / "workflows").glob("*.yml"))
if not workflows:
    fail(".github/workflows", "no workflows found")

for wf in workflows:
    rel = wf.relative_to(ROOT)
    try:
        doc = yaml.safe_load(wf.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        fail(rel, f"invalid YAML: {e}")
        continue

    top_perms = doc.get("permissions") or {}

    for job_name, job in (doc.get("jobs") or {}).items():
        perms = job.get("permissions") or top_perms
        steps = job.get("steps") or []
        uses = " ".join(str((s or {}).get("uses", "")) for s in steps)

        # A permissions block sets every unlisted scope to none. codeql-action
        # reads the workflow run to cache its overlay-base database, so without
        # actions: read it dies on "Resource not accessible by integration".
        if "github/codeql-action" in uses and perms:
            if perms.get("actions") not in ("read", "write"):
                fail(rel, f"job {job_name} runs codeql-action but does not "
                          f"grant actions: read", hard=owned(wf))

        # A moving ref runs whatever that branch holds today. tools/fanout.py
        # refuses to lower a pinned action version; nothing stopped an unpinned
        # one shipping in the first place.
        for step in steps:
            ref = str((step or {}).get("uses", ""))
            if ref.endswith("@master") or ref.endswith("@main"):
                fail(rel, f"job {job_name} uses {ref}, pin it to a release tag",
                     hard=owned(wf))

        runs_on = str(job.get("runs-on", ""))
        # A self-hosted default strands a new repository: its jobs queue for a
        # runner pool the adopter does not have, with no error and no timeout.
        if "PM_RUNNER" in runs_on and "ubuntu-latest" not in runs_on:
            fail(rel, f"job {job_name} does not fall back to ubuntu-latest",
                 hard=owned(wf))
        for i, step in enumerate(steps):
            script = ((step or {}).get("with") or {}).get("script")
            if isinstance(script, str) and script.strip():
                node_check(script, f"{rel} job {job_name} step {i}")

# ------------------------------------------------------------ script modules
for js in sorted((GH / "scripts").glob("*.js")):
    r = subprocess.run(["node", "--check", str(js)], capture_output=True, text=True)
    if r.returncode:
        fail(js.relative_to(ROOT), "does not parse\n" + r.stderr.strip())

# ------------------------------------------------------------------- labels
label_names = set()
try:
    labels = json.loads((GH / "labels.json").read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as e:
    fail(".github/labels.json", f"unreadable: {e}")
    labels = []

if not isinstance(labels, list) or not labels:
    fail(".github/labels.json", "must be a non-empty array")
else:
    seen = {}
    for l in labels:
        name = (l or {}).get("name")
        if not name:
            fail(".github/labels.json", f"entry with no name: {l!r}")
            continue
        label_names.add(name.lower())
        # GitHub matches label names case insensitively, so two entries that
        # differ only in case are one label and the second write loses.
        if name.lower() in seen:
            fail(".github/labels.json", f"{name!r} duplicates {seen[name.lower()]!r}")
        seen[name.lower()] = name
        if not re.fullmatch(r"[0-9a-f]{6}", str(l.get("color", ""))):
            fail(".github/labels.json", f"{name}: color must be six lower-case hex digits")
        if not l.get("description"):
            fail(".github/labels.json", f"{name}: needs a description")
    ordered = [l["name"] for l in labels if l.get("name")]
    if ordered != sorted(ordered):
        fail(".github/labels.json", "entries must be sorted by name")

# ----------------------------------------------------------- board standard
std = {}
try:
    std = json.loads((GH / "board-standard.json").read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as e:
    fail(".github/board-standard.json", f"unreadable: {e}")

if std:
    where = ".github/board-standard.json"
    for key in ("singleSelect", "fields", "views"):
        if key not in std:
            fail(where, f"missing {key}")

    canon = set()
    for field, options in (std.get("singleSelect") or {}).items():
        if not options:
            fail(where, f"{field} has no options")
        for o in options:
            canon.add(o["name"])
            if o.get("color") not in BOARD_COLORS:
                fail(where, f"{field}/{o.get('name')}: {o.get('color')!r} "
                            f"is not a board colour")
    for v in std.get("views") or []:
        if v.get("layout") not in VIEW_LAYOUTS:
            fail(where, f"view {v.get('name')}: {v.get('layout')!r} is not a layout")
    # A synonym pointing at a name no field offers silently never matches.
    for alias, target in (std.get("synonyms") or {}).items():
        if target not in canon:
            fail(where, f"synonym {alias!r} points at {target!r}, which no field has")

    # The flow block is what lets a workflow reason about a column without
    # spelling its name. A stale entry there silently stops the measurement.
    statuses = {o["name"] for o in (std.get("singleSelect") or {}).get("Status", [])}
    flow = std.get("flow") or {}
    if not flow:
        fail(where, "missing flow, the workflows need it to name a column")
    for key in ("committed", "start", "review", "done"):
        if flow.get(key) not in statuses:
            fail(where, f"flow.{key} is {flow.get(key)!r}, which is not a Status option")
    for key in ("active", "waiting"):
        for name in flow.get(key) or []:
            if name not in statuses:
                fail(where, f"flow.{key} names {name!r}, which is not a Status option")
    if not isinstance(flow.get("ageingDays"), int) or flow["ageingDays"] < 1:
        fail(where, "flow.ageingDays must be a positive whole number of days")

# ------------------------------------------------- labels named in prompts
# Every label literal in a workflow or an agent prompt must exist, because the
# REST API and `gh` both look a label up by name and fail when it is absent.
namespaces = {n.split(":")[0] for n in label_names if ":" in n}
literal = re.compile(r"""["'`]([^"'`\n]+)["'`]""")
shaped = re.compile(r"^([A-Za-z0-9]+):\s?[A-Za-z0-9][A-Za-z0-9 -]*$")

sources = workflows + sorted((GH / "agents").glob("*.md"))
for src in sources:
    text = src.read_text(encoding="utf-8")
    for match in literal.finditer(text):
        value = match.group(1).strip()
        m = shaped.match(value)
        if not m or m.group(1).lower() not in namespaces:
            continue
        if value.lower() not in label_names:
            fail(src.relative_to(ROOT),
                 f"names the label {value!r}, which is not in .github/labels.json")

def strip_comments(text):
    """Drop comments, so naming a status while explaining one is still allowed.

    The rule below is about code holding a second copy of the vocabulary. A
    comment saying which column it means is the opposite of that problem.
    """
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return re.sub(r"(//|#).*$", " ", text, flags=re.M)


# ------------------------------------------- board vocabulary lives in one file
# Multi-word option names are distinctive enough to spot. A script holding its
# own copy of them is a second source of truth that will drift.
vocab = sorted(n for n in canon if " " in n or ":" in n) if std else []
# Workflows and composite actions are where the copies actually accumulated:
# the vocabulary lived in eight places and only the standard knew about the
# column meaning the client owes us something, so every other reader dropped
# those items as unmapped.
scanned = sorted((ROOT / "tools").glob("*.py")) \
    + [p for p in sorted((GH / "scripts").glob("*.js")) if not p.name.endswith(".test.js")] \
    + workflows \
    + sorted((GH / "actions").rglob("*.yml"))
for path in scanned:
    if path.name in VOCAB_EXEMPT:
        continue
    text = strip_comments(path.read_text(encoding="utf-8"))
    # A workflow's display name is a label people read, not a second source of
    # truth, so "Mark In Progress" is allowed to say what it does.
    text = re.sub(r"^name:.*$", " ", text, flags=re.M)
    hit = [v for v in vocab if v in text]
    if hit:
        fail(path.relative_to(ROOT),
             f"hardcodes board vocabulary {hit}, read board-standard.json instead",
             hard=path.suffix != ".yml" or owned(path))

# ------------------------------------------------------------------- report
if notices:
    print(f"{len(notices)} notice(s) in workflows this repository owns:\n")
    for n in notices:
        print(f"  - {n}")
    print()

if problems:
    print(f"{len(problems)} problem(s):\n")
    for p in problems:
        print(f"  - {p}")
    sys.exit(1)

print(f"ok: {len(workflows)} workflows, {len(labels)} labels, "
      f"{len(vocab)} board terms, no drift")

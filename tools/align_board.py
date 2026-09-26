#!/usr/bin/env python3
"""Align an organization ProjectV2 board to the standard in .github/board-standard.json.

Non destructive by design:
  - single select options are always sent back complete and by id, so renaming
    or reordering never drops an item's value
  - options the board added itself are kept, appended after the canonical ones
  - the ONLY deletion is a Priority field that is a single select with zero
    options. That is GitHub's built in Priority, it can hold no value, and it
    squats the name so a writable Priority cannot be created next to it.

Usage:
  ORG=<your-org> align_board.py <project-number> [--apply]
"""
import json
import os
import subprocess
import sys
from pathlib import Path

# The organization that owns the board. Read from the ORG environment variable
# so nothing here is tied to one organization.
ORG = os.environ.get("ORG", "").strip()

# The standard lives in .github/board-standard.json, so this script and
# 30-sync-board.yml cannot drift apart. Change the board there, never here.
STANDARD = Path(__file__).resolve().parent.parent / ".github" / "board-standard.json"
_std = json.loads(STANDARD.read_text(encoding="utf-8"))
_single = _std["singleSelect"]

STATUS = [(o["name"], o["color"]) for o in _single["Status"]]
PRIORITY = [(o["name"], o["color"]) for o in _single["Priority"]]
SIZE = [(o["name"], o["color"]) for o in _single["Size"]]

PLAIN = [(f["name"], f["dataType"]) for f in _std["fields"]]

VIEWS = [(v["name"], v["layout"], v.get("filter")) for v in _std["views"]]

SYN = {k.lower(): v for k, v in _std["synonyms"].items()}


def gql(query, **vars):
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in vars.items():
        # -f sends every value as a String; ints must go through -F to stay typed.
        args += (["-F", f"{k}={v}"] if isinstance(v, int) else ["-f", f"{k}={v}"])
    r = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if r.returncode:
        raise SystemExit(f"gql failed: {r.stderr.strip()[:300]}")
    out = json.loads(r.stdout)
    if "errors" in out:
        raise SystemExit(f"gql errors: {json.dumps(out['errors'])[:300]}")
    return out["data"]


def load(num):
    q = """query($login:String!,$n:Int!){organization(login:$login){projectV2(number:$n){
      id title closed
      fields(first:50){nodes{__typename
        ... on ProjectV2FieldCommon{id name dataType}
        ... on ProjectV2SingleSelectField{options{id name color description}}}}
      views(first:20){nodes{id name layout}}}}}"""
    p = gql(q, login=ORG, n=num)["organization"]["projectV2"]
    fields = {}
    for n in p["fields"]["nodes"]:
        if n and n.get("name"):
            fields[n["name"]] = n
    return p, fields


def opts_payload(field, canonical):
    """Complete option list: canonical first in order, board's own extras after."""
    existing = field.get("options") or []
    canon_by_lower = {n.lower(): n for n, _c in canonical}
    by_target, extras, seen = {}, [], set()
    for o in existing:
        low = o["name"].strip().lower()
        # A synonym wins; otherwise an option already named like a canonical one
        # is that canonical one, so Size XS..XL is not mistaken for board-specific.
        t = SYN.get(low) or canon_by_lower.get(low)
        if t and t in dict(canonical) and t not in seen:
            by_target[t] = o
            seen.add(t)
        else:
            extras.append(o)
    payload, actions = [], []
    for name, color in canonical:
        o = by_target.get(name)
        if o:
            if o["name"] != name:
                actions.append(f"rename '{o['name']}' -> '{name}'")
            elif (o.get("color") or "") != color:
                actions.append(f"recolour {name}")
            payload.append({"id": o["id"], "name": name, "color": color, "description": ""})
        else:
            actions.append(f"add '{name}'")
            payload.append({"name": name, "color": color, "description": ""})
    for o in extras:
        payload.append({"id": o["id"], "name": o["name"],
                        "color": o.get("color") or "GRAY",
                        "description": o.get("description") or ""})
    order_now = [o["name"] for o in existing]
    order_new = [p["name"] for p in payload]
    if order_now != order_new and not any(a.startswith(("add", "rename")) for a in actions):
        actions.append("reorder")
    # Keeping the board's own options is not work; noting it as such would stop
    # the tool ever reporting a board as aligned.
    notes = ([f"keeps {len(extras)} board-specific: {[o['name'] for o in extras]}"]
             if extras else [])
    return payload, actions, notes


def gql_opts(payload):
    parts = []
    for o in payload:
        bits = []
        if "id" in o:
            bits.append(f'id:"{o["id"]}"')
        name = o["name"].replace("\\", "\\\\").replace('"', '\\"')
        bits.append(f'name:"{name}"')
        bits.append(f'color:{o["color"]}')
        desc = (o.get("description") or "").replace("\\", "\\\\").replace('"', '\\"')
        bits.append(f'description:"{desc}"')
        parts.append("{" + ",".join(bits) + "}")
    return "[" + ",".join(parts) + "]"


def main():
    if not ORG:
        raise SystemExit("ORG is not set. Export it first, for example: export ORG=your-org")
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    num, apply = int(sys.argv[1]), "--apply" in sys.argv
    p, fields = load(num)
    print(f"#{num} {p['title']}{'  (closed)' if p['closed'] else ''}")
    work, keeps = [], []

    # Priority: a single select with no options is GitHub's built in field. It can
    # hold no value, so removing it loses nothing and frees the name.
    pri = fields.get("Priority")
    if pri and pri["dataType"] == "SINGLE_SELECT" and not (pri.get("options") or []):
        work.append(("drop-builtin-priority", pri["id"], None,
                     ["replace built-in Priority (no options, unwritable) with a custom one"]))
        pri = None
    elif pri and pri["dataType"] != "SINGLE_SELECT":
        print(f"    ! Priority is {pri['dataType']}, left alone")
        pri = "skip"

    for fname, canon in (("Status", STATUS), ("Size", SIZE)):
        f = fields.get(fname)
        if f and f["dataType"] == "SINGLE_SELECT":
            payload, actions, notes = opts_payload(f, canon)
            keeps.extend(notes)
            if actions:
                work.append(("update-select", f["id"], payload, actions))
        elif not f:
            work.append(("create-select", fname, canon, [f"create field '{fname}'"]))

    if pri is None:
        work.append(("create-select", "Priority", PRIORITY, ["create field 'Priority'"]))
    elif pri != "skip" and pri:
        payload, actions, notes = opts_payload(pri, PRIORITY)
        keeps.extend(notes)
        if actions:
            work.append(("update-select", pri["id"], payload, actions))

    lower_fields = {k.lower() for k in fields}
    for fname, dtype in PLAIN:
        # GitHub enforces field-name uniqueness case insensitively, so a board
        # carrying "Start Date" must not be asked to create "Start date".
        if fname.lower() not in lower_fields:
            work.append(("create-plain", fname, dtype, [f"create field '{fname}' ({dtype})"]))

    have_views = {v["name"] for v in p["views"]["nodes"]}
    for vname, layout, filt in VIEWS:
        if vname not in have_views:
            work.append(("create-view", vname, (layout, filt), [f"create view '{vname}'"]))

    for n in keeps:
        print(f"    . {n}")
    if not work:
        print("    already aligned")
        return
    for _k, _a, _b, actions in work:
        for a in actions:
            print(f"    - {a}")
    if not apply:
        print("    dry run, nothing changed")
        return

    for kind, a, b, actions in work:
        try:
            if kind == "update-select":
                gql("mutation($f:ID!){updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:"
                    + gql_opts(b) + "}){projectV2Field{... on ProjectV2SingleSelectField{id}}}}", f=a)
            elif kind == "create-select":
                gql("mutation($p:ID!){createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,"
                    + f'name:"{a}",singleSelectOptions:'
                    + gql_opts([{"name": n, "color": c, "description": ""} for n, c in b])
                    + "}){projectV2Field{... on ProjectV2SingleSelectField{id}}}}", p=p["id"])
            elif kind == "create-plain":
                gql("mutation($p:ID!){createProjectV2Field(input:{projectId:$p,"
                    + f'dataType:{b},name:"{a}"'
                    + "}){projectV2Field{... on ProjectV2FieldCommon{id}}}}", p=p["id"])
            elif kind == "drop-builtin-priority":
                gql("mutation($f:ID!){deleteProjectV2Field(input:{fieldId:$f})"
                    "{projectV2Field{... on ProjectV2FieldCommon{id}}}}", f=a)
            elif kind == "create-view":
                layout, filt = b
                v = gql("mutation($p:ID!){createProjectV2View(input:{projectId:$p,"
                        + f'name:"{a}",layout:{layout}'
                        + "}){projectV2View{id}}}", p=p["id"])
                if filt:
                    vid = v["createProjectV2View"]["projectV2View"]["id"]
                    gql("mutation($v:ID!,$f:String!){updateProjectV2View(input:{viewId:$v,filter:$f})"
                        "{projectV2View{id}}}", v=vid, f=filt)
            print(f"    applied: {actions[0]}")
        except SystemExit as e:
            print(f"    FAILED {kind} {a}: {str(e)[:160]}")


if __name__ == "__main__":
    main()

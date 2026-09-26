#!/usr/bin/env python3
"""Delete Status options that are not part of the standard AND hold no items.

Deleting a single select option deletes that value on every item using it, so
this counts items per option first and only ever removes options with a count of
zero. Anything a team is actually using is left exactly where it is.

Usage:
  ORG=<your-org> prune_empty_statuses.py <project-number> [--apply]
"""
import collections
import json
import os
import subprocess
import sys
from pathlib import Path

# The organization that owns the board. Read from the ORG environment variable
# so nothing here is tied to one organization.
ORG = os.environ.get("ORG", "").strip()

# The standard lives in .github/board-standard.json. Change the board there.
STANDARD = Path(__file__).resolve().parent.parent / ".github" / "board-standard.json"
_status = json.loads(STANDARD.read_text(encoding="utf-8"))["singleSelect"]["Status"]

CANON = [o["name"] for o in _status]
COLOR = {o["name"]: o["color"] for o in _status}


def gql(query, **vars):
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in vars.items():
        args += (["-F", f"{k}={v}"] if isinstance(v, int) else ["-f", f"{k}={v}"])
    r = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if r.returncode:
        raise SystemExit(f"gql failed: {r.stderr.strip()[:300]}")
    out = json.loads(r.stdout)
    if "errors" in out:
        raise SystemExit(f"gql errors: {json.dumps(out['errors'])[:300]}")
    return out["data"]


def counts(pid):
    q = """query($id:ID!,$after:String){node(id:$id){... on ProjectV2{
      items(first:100,after:$after){pageInfo{hasNextPage endCursor}
        nodes{fieldValueByName(name:"Status"){
          ... on ProjectV2ItemFieldSingleSelectValue{optionId}}}}}}}"""
    after, c, total = None, collections.Counter(), 0
    while True:
        d = gql(q, id=pid, **({"after": after} if after else {}))["node"]["items"]
        for it in d["nodes"]:
            total += 1
            v = it.get("fieldValueByName")
            if v and v.get("optionId"):
                c[v["optionId"]] += 1
        if not d["pageInfo"]["hasNextPage"]:
            break
        after = d["pageInfo"]["endCursor"]
    return c, total


def main():
    if not ORG:
        raise SystemExit("ORG is not set. Export it first, for example: export ORG=your-org")
    num, apply = int(sys.argv[1]), "--apply" in sys.argv
    q = """query($login:String!,$n:Int!){organization(login:$login){projectV2(number:$n){
      id title fields(first:60){nodes{
        ... on ProjectV2SingleSelectField{id name options{id name color description}}}}}}}"""
    p = gql(q, login=ORG, n=num)["organization"]["projectV2"]
    st = next((f for f in p["fields"]["nodes"]
               if f and f.get("name") == "Status"), None)
    if not st:
        print(f"#{num} {p['title']}: no Status field")
        return

    extras = [o for o in st["options"] if o["name"] not in CANON]
    if not extras:
        print(f"#{num} {p['title']}: no extra columns")
        return

    c, total = counts(p["id"])
    empty = [o for o in extras if c[o["id"]] == 0]
    used = [o for o in extras if c[o["id"]] > 0]
    print(f"#{num} {p['title']}  ({total} items)")
    for o in used:
        print(f"    keep   '{o['name']}'  ({c[o['id']]} items)")
    for o in empty:
        print(f"    DROP   '{o['name']}'  (empty)")
    if not empty:
        return
    if not apply:
        print("    dry run, nothing changed")
        return

    payload = [{"id": next(o["id"] for o in st["options"] if o["name"] == n),
                "name": n, "color": COLOR[n], "description": ""}
               for n in CANON if any(o["name"] == n for o in st["options"])]
    payload += [{"id": o["id"], "name": o["name"],
                 "color": o.get("color") or "GRAY",
                 "description": o.get("description") or ""} for o in used]
    opts = "[" + ",".join(
        "{" + f'id:"{o["id"]}",name:"{o["name"]}",color:{o["color"]},description:""' + "}"
        for o in payload) + "]"
    gql("mutation($f:ID!){updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:"
        + opts + "}){projectV2Field{... on ProjectV2SingleSelectField{id}}}}", f=st["id"])
    print(f"    dropped {len(empty)}, kept {len(used)}")


if __name__ == "__main__":
    main()

"""Invariant I2: neither v2 contract contains a wall-clock comparison that
authorizes a release.

This parses contracts/v2/*.py with the Python AST and lists every comparison
that involves the chain clock. Each one must be on an allowlist of exactly where
and how it may appear, and each must have the semantics the allowlist claims:

* a comparison may only ever DENY (its true branch refuses or returns without
  releasing), or
* it may authorize a RETURN OF VALUE TO THE FUNDER (reclaim_after_deadline).

The allowlist is the whole policy. Anything else, including any arithmetic on
the clock, any appeal-window style constant, or any comparison in a function not
named here, fails the check.

Writes docs/evidence/milestone/no-clock-check.json. Exit code 1 on a violation.
"""

from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V2 = ROOT / "contracts" / "v2"
OUT = ROOT / "docs" / "evidence" / "milestone" / "no-clock-check.json"

CLOCK_CALLS = {"_now_unix", "_unix_from_iso"}
FORBIDDEN_NAME = re.compile(r"APPEAL|WINDOW|ELAPSED|DELAY|TIMER", re.IGNORECASE)

# (file, function) -> what the one allowed comparison is, and what it may do.
ALLOW = {
    ("decision_gate.py", "create_action"): {
        "op": "LtE", "clock": "right", "effect": "deny",
        "why": "a new action's deadline must lie in the future",
    },
    ("decision_gate.py", "request_adjudication"): {
        "op": "Gt", "clock": "left", "effect": "deny",
        "why": "an expired action is not adjudicated",
    },
    ("finality_vault.py", "open_escrow"): {
        "op": "LtE", "clock": "right", "effect": "deny",
        "why": "an escrow's deadline must lie in the future",
    },
    ("finality_vault.py", "authorize_release"): {
        "op": "Gt", "clock": "left", "effect": "deny-and-route-to-refund",
        "why": "a release delivered after the deadline does not release; it routes the escrow to a refund",
    },
    ("finality_vault.py", "reclaim_after_deadline"): {
        "op": "LtE", "clock": "left", "effect": "deny",
        "why": "the funder may reclaim only after the deadline; the effect is a return to the funder",
    },
}


def mentions_clock(node: ast.AST, clock_vars: set[str]) -> bool:
    for child in ast.walk(node):
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name) and child.func.id in CLOCK_CALLS:
            return True
        if isinstance(child, ast.Name) and child.id in clock_vars:
            return True
    return False


def body_has(body: list[ast.stmt], predicate) -> bool:
    return any(predicate(n) for stmt in body for n in ast.walk(stmt))


def is_return(n: ast.AST) -> bool:
    return isinstance(n, ast.Return)


def is_user_error(n: ast.AST) -> bool:
    return (
        isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "immediate"
    )


def is_transfer(n: ast.AST) -> bool:
    return isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "emit_transfer"


def sets_settled(n: ast.AST) -> bool:
    if isinstance(n, ast.Assign):
        return isinstance(n.value, ast.Name) and n.value.id == "STATE_SETTLED"
    return False


def analyse(path: Path) -> tuple[list[dict], list[str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: list[dict] = []
    violations: list[str] = []

    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                # A clock policy is a number of seconds (v1: APPEAL_WINDOW_SECONDS = 120). A string
                # reason code that happens to contain the word WINDOW is not one.
                numeric = isinstance(node.value, ast.Constant) and isinstance(node.value.value, (int, float)) and not isinstance(node.value.value, bool)
                if isinstance(target, ast.Name) and FORBIDDEN_NAME.search(target.id) and numeric:
                    violations.append(f"{path.name}: module constant {target.id} is a numeric clock policy")

    functions = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    for fn in functions:
        if fn.name in CLOCK_CALLS:
            continue
        clock_vars: set[str] = set()
        for n in ast.walk(fn):
            if isinstance(n, ast.Assign) and mentions_clock(n.value, set()):
                for t in n.targets:
                    if isinstance(t, ast.Name):
                        clock_vars.add(t.id)

        # arithmetic on the clock is never allowed
        for n in ast.walk(fn):
            if isinstance(n, ast.BinOp) and isinstance(n.op, (ast.Add, ast.Sub)) and mentions_clock(n, clock_vars):
                violations.append(f"{path.name}:{n.lineno} {fn.name}: arithmetic on the clock")

        # every `if` whose test compares the clock
        for n in ast.walk(fn):
            if not isinstance(n, ast.If):
                continue
            for cmp_ in [c for c in ast.walk(n.test) if isinstance(c, ast.Compare)]:
                operands = [cmp_.left, *cmp_.comparators]
                if not any(mentions_clock(o, clock_vars) for o in operands):
                    continue
                op = type(cmp_.ops[0]).__name__
                clock_side = "left" if mentions_clock(cmp_.left, clock_vars) else "right"
                key = (path.name, fn.name)
                record = {
                    "file": path.name, "function": fn.name, "line": cmp_.lineno,
                    "operator": op, "clock_on": clock_side,
                    "denies": body_has(n.body, is_return) or body_has(n.body, is_user_error),
                    "emits_transfer_in_branch": body_has(n.body, is_transfer),
                    "sets_settled_in_branch": body_has(n.body, sets_settled),
                }
                allowed = ALLOW.get(key)
                if allowed is None:
                    record["verdict"] = "VIOLATION: function is not on the allowlist"
                    violations.append(f"{path.name}:{cmp_.lineno} {fn.name}: clock comparison not on the allowlist")
                else:
                    record["policy"] = allowed
                    problems = []
                    if op != allowed["op"] or clock_side != allowed["clock"]:
                        problems.append(f"expected {allowed['clock']}-side {allowed['op']}, found {clock_side}-side {op}")
                    if not record["denies"]:
                        problems.append("the branch taken when the comparison holds does not deny")
                    if record["sets_settled_in_branch"]:
                        problems.append("the branch settles an escrow")
                    if allowed["effect"] != "deny-and-route-to-refund" and record["emits_transfer_in_branch"]:
                        problems.append("the branch transfers value")
                    record["verdict"] = "ok" if not problems else "VIOLATION: " + "; ".join(problems)
                    for p in problems:
                        violations.append(f"{path.name}:{cmp_.lineno} {fn.name}: {p}")
                found.append(record)

    # an allowlisted function must actually contain its comparison (the policy cannot rot)
    seen = {(f["file"], f["function"]) for f in found}
    for key in ALLOW:
        if key[0] == path.name and key not in seen:
            violations.append(f"{key[0]} {key[1]}: allowlisted clock comparison not found; update the allowlist")
    return found, violations


def main() -> int:
    all_found: list[dict] = []
    all_violations: list[str] = []
    files = sorted(p for p in V2.glob("*.py"))
    for path in files:
        found, violations = analyse(path)
        all_found.extend(found)
        all_violations.extend(violations)

    report = {
        "invariant": "I2: no wall-clock comparison authorizes a release",
        "files": [p.name for p in files],
        "comparisons": all_found,
        "violations": all_violations,
        "pass": not all_violations,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    for v in all_violations:
        print("XX", v)
    print(f"clock comparisons found: {len(all_found)} across {len(files)} files; {'PASS' if report['pass'] else 'FAIL'}")
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())

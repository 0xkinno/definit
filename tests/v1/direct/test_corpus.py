"""Run the v1 corpus against the real vault.

Every case in tests/v1/fixtures/cases-v1.json is executed step by step. The
observed result of each step and of the final state is written to
docs/evidence/milestone/corpus-v1-results.json, whether the case passed or not,
so the report is generated from what happened and not from what was expected.
"""

import json
from pathlib import Path

import pytest

from v1.harness import contract_path, DEADLINE, FUNDER, LATE, NOW, RECIPIENT, POLICY_HASH, AMOUNT, RevertedWith, Scenario, intent_hash, iso, EVIDENCE_DIGEST

ROOT = Path(__file__).resolve().parents[3]
CASES = json.loads((ROOT / "tests" / "v1" / "fixtures" / "cases-v1.json").read_text(encoding="utf-8"))["cases"]
RESULTS = ROOT / "docs" / "evidence" / "milestone" / "corpus-v1-results.json"
VAULT = "contracts/v1/finality_vault.py"

TIMES = {"NOW": NOW, "LATE": LATE, "DEADLINE": iso(DEADLINE), "AFTER_DEADLINE": iso(DEADLINE + 1)}
_recorded: list[dict] = []


@pytest.fixture(scope="module", autouse=True)
def write_results():
    yield
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(_recorded, key=lambda r: [c["id"] for c in CASES].index(r["id"]))
    RESULTS.write_text(
        json.dumps({"source": "tests/v1/fixtures/cases-v1.json", "ran": len(ordered), "results": ordered}, indent=2),
        encoding="utf-8",
    )


def run_step(s: Scenario, step: dict) -> dict:
    """Perform one step and return what the contract did, as data."""
    do, who = step["do"], step["as"]
    try:
        if do == "warp":
            s.world.set_time(TIMES[step["to"]])
            return {"outcome": "ok"}
        if do == "release":
            over = dict(step.get("over", {}))
            if "other_digest" in step:
                over["intent_hash"] = intent_hash(FUNDER, RECIPIENT, AMOUNT, "GEN", POLICY_HASH, step["other_digest"], 7, DEADLINE)
            result = s.deliver_release(who, **over)
        elif do == "refuse":
            result = s.deliver_refusal(who)
        elif do == "note":
            result = s.deliver_note(who, verdict=step.get("verdict", "APPROVE"))
        elif do == "withdraw":
            result = s.call(who, "withdraw_refund", s.action_id)
        elif do == "reclaim":
            result = s.call(who, "reclaim_after_deadline", s.action_id)
        else:
            raise AssertionError(f"unknown step {do}")
    except RevertedWith as refusal:
        return {"outcome": "revert", "code": refusal.code}
    status = result.get("status")
    return {"outcome": "noop" if status == "NOOP" else "ok", "status": status}


def matches(observed: dict, expect: str) -> bool:
    if expect == "ok":
        return observed["outcome"] == "ok"
    if expect == "noop":
        return observed["outcome"] == "noop"
    kind, _, value = expect.partition(":")
    if kind == "revert":
        return observed["outcome"] == "revert" and observed.get("code") == value
    if kind == "status":
        return observed["outcome"] == "ok" and observed.get("status") == value
    raise AssertionError(f"unknown expectation {expect}")


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_case(case, direct_vm, direct_deploy, repo_root):
    s = Scenario(direct_vm, direct_deploy, contract_path(repo_root, VAULT)).ready()
    observed_steps = []
    for step in case["steps"]:
        observed = run_step(s, step)
        observed["expected"] = step["expect"]
        observed["matched"] = matches(observed, step["expect"])
        observed_steps.append(observed)

    final = {
        "state": s.state(),
        "to_recipient": s.transferred_to("recipient"),
        "to_funder": s.transferred_to("funder"),
    }
    passed = all(o["matched"] for o in observed_steps) and final == case["final"]
    _recorded.append(
        {
            "id": case["id"],
            "invariant": case["invariant"],
            "title": case["title"],
            "passed": passed,
            "steps": observed_steps,
            "expected_final": case["final"],
            "observed_final": final,
        }
    )
    assert all(o["matched"] for o in observed_steps), [o for o in observed_steps if not o["matched"]]
    assert final == case["final"]

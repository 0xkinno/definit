"""Random lifecycles, thousands of them, against the real vault and the model.

One vault is deployed. Each lifecycle is its own escrow with its own amount and
deadline, driven through a random sequence of events: releases (matching,
altered, forged, from the wrong sender), refusals, provisional notices (repeated
and alternating), withdrawals and reclaims (before, at and after the deadline).
Every event is also given to the pure model in contracts/v1/core/vault_model.py,
and the two must agree on the refusal code or the recorded no-op, the resulting
state and the value that moved.

Conservation (I12) is checked per escrow after every event: released plus
returned is zero or exactly the escrowed amount, never negative, never more, and
exactly the amount once the escrow reaches a paying terminal state. I4, I5, I9
and I11 follow: no escrow pays twice, a notice never moves value, a clock only
ever returns value to the funder, and no ordering of release and reclaim
produces two transfers.

Seeds are recorded. A failure prints the seed, the lifecycle index and the full
event trace, so it reproduces exactly:

    PROPERTY_SEEDS=7 PROPERTY_LIFECYCLES=1000 npm run test:v1:property
"""

import json
import os
import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "contracts" / "v1" / "core"))

import vault_model as model  # noqa: E402

from v1.harness import (  # noqa: E402
    ACTOR, EVIDENCE_DIGEST, FUNDER, GATE, POLICY_HASH, RECIPIENT, RevertedWith, Scenario, contract_path, intent_hash, iso,
)

VAULT = "contracts/v1/finality_vault.py"
SEEDS = [int(x) for x in os.environ.get("PROPERTY_SEEDS", "1,2,3").split(",") if x.strip()]
LIFECYCLES = int(os.environ.get("PROPERTY_LIFECYCLES", "1000"))
BASE = 2_000_000_000  # a unix time safely before every deadline below
RESULTS = ROOT / "docs" / "evidence" / "milestone" / "property.json"

KINDS = [
    # (name, event, sender role, delivery flags)
    ("release_ok", "authorize_release", "gate", {}),
    ("release_ok", "authorize_release", "gate", {}),
    ("release_field", "authorize_release", "gate", {"fields_match": False}),
    ("release_forged", "authorize_release", "gate", {"commitment_matches": False}),
    ("release_stranger", "authorize_release", "other", {}),
    ("refuse", "close_refused", "gate", {}),
    ("refuse_stranger", "close_refused", "other", {}),
    ("note_approve", "note_provisional", "gate", {"verdict": "APPROVE"}),
    ("note_reject", "note_provisional", "gate", {"verdict": "REJECT"}),
    ("note_stranger", "note_provisional", "other", {"verdict": "APPROVE"}),
    ("withdraw_funder", "withdraw_refund", "funder", {}),
    ("withdraw_other", "withdraw_refund", "other", {}),
    ("reclaim_funder", "reclaim_after_deadline", "funder", {}),
    ("reclaim_funder", "reclaim_after_deadline", "funder", {}),
    ("reclaim_other", "reclaim_after_deadline", "other", {}),
]
WHEN = ["before", "at", "after", "after"]


def run_seed(seed, vault_path, direct_vm, direct_deploy):
    rng = random.Random(seed)
    s = Scenario(direct_vm, direct_deploy, vault_path)
    s.bind_gate()
    actions = {}
    s.world.answer(GATE, "get_action", lambda aid: actions[aid])

    stats = {"seed": seed, "lifecycles": 0, "events": 0, "refusals": 0, "noops": 0, "released": 0, "returned": 0, "terminal": {}}
    for index in range(LIFECYCLES):
        aid = f"prop-{seed}-{index}"
        amount = rng.randint(1, 1_000_000)
        nonce = rng.randint(1, 10**9)
        deadline = BASE + rng.randint(1_000, 50_000)
        actions[aid] = {
            "exists": True, "agent": FUNDER, "recipient": RECIPIENT, "amount": amount, "asset": "GEN",
            "policy_hash": POLICY_HASH, "nonce": nonce, "deadline_unix": deadline,
        }
        s.world.set_time(iso(BASE))
        s.action_id, s.nonce = aid, nonce
        s.call("funder", "open_escrow", aid, RECIPIENT, amount, "GEN", POLICY_HASH, nonce, deadline, value=amount)

        esc = model.Escrow(state=model.OPEN, amount=amount, deadline=deadline)
        paid_recipient = paid_funder = 0
        trace = []

        for _ in range(rng.randint(1, 8)):
            name, event, role, flags = rng.choice(KINDS)
            when = rng.choice(WHEN)
            now = {"before": BASE + 1, "at": deadline, "after": deadline + rng.randint(1, 5_000)}[when]
            sender = rng.choice(["stranger", "recipient", "owner"]) if role == "other" else role
            delivery = model.Delivery(**flags)
            expected = model.step(esc, event, {"gate": model.GATE, "funder": model.FUNDER}.get(role, model.OTHER), now, delivery)
            trace.append((name, when, sender))

            s.world.set_time(iso(now))
            before = len(s.world.emitted)
            observed = {"refusal": "", "noop": False, "status": ""}
            try:
                if event == "authorize_release":
                    recipient = "0x" + "66" * 20 if (not delivery.fields_match and rng.random() < 0.25) else RECIPIENT
                    amt = amount + 1 if (not delivery.fields_match and recipient == RECIPIENT and rng.random() < 0.5) else amount
                    good_hash = intent_hash(FUNDER, RECIPIENT, amount, "GEN", POLICY_HASH, EVIDENCE_DIGEST, nonce, deadline)
                    use_hash = good_hash if delivery.commitment_matches else "0x" + "ee" * 32
                    if not delivery.fields_match and recipient == RECIPIENT and amt == amount:
                        nonce_sent = nonce + 1
                    else:
                        nonce_sent = nonce
                    result = s.call(sender, "authorize_release", aid, "0x" + "d1" * 32, use_hash, EVIDENCE_DIGEST, POLICY_HASH, nonce_sent, recipient, amt)
                elif event == "close_refused":
                    result = s.call(sender, "close_refused", aid, "0x" + "d2" * 32, "EVIDENCE_MISSING")
                elif event == "note_provisional":
                    result = s.call(sender, "note_provisional", aid, "0x" + "d3" * 32, delivery.verdict)
                elif event == "withdraw_refund":
                    result = s.call(sender, "withdraw_refund", aid)
                else:
                    result = s.call(sender, "reclaim_after_deadline", aid)
                observed["status"] = result.get("status", "")
                observed["noop"] = result.get("status") == "NOOP"
            except RevertedWith as refusal:
                observed["refusal"] = refusal.code

            moved = [m for m in s.world.emitted[before:] if m.method is None and m.value > 0]
            to_recipient = sum(m.value for m in moved if m.target == RECIPIENT)
            to_funder = sum(m.value for m in moved if m.target == FUNDER)

            context = f"seed={seed} lifecycle={index} amount={amount} deadline={deadline} trace={trace}"
            assert observed["refusal"] == expected.refusal, f"refusal differs: vault {observed['refusal']!r}, model {expected.refusal!r}; {context}"
            assert observed["noop"] == expected.noop, f"no-op differs; {context}"
            assert s.state() == expected.state, f"state differs: vault {s.state()}, model {expected.state}; {context}"
            assert to_recipient == expected.to_recipient and to_funder == expected.to_funder, f"value differs; {context}"

            # I12 conservation, per escrow, after every event
            paid_recipient += to_recipient
            paid_funder += to_funder
            assert paid_recipient >= 0 and paid_funder >= 0
            assert paid_recipient + paid_funder in (0, amount), f"released plus returned is {paid_recipient + paid_funder}, not 0 or {amount}; {context}"
            assert not (paid_recipient and paid_funder), f"an escrow paid both sides; {context}"
            if event == "note_provisional":
                assert to_recipient == 0 and to_funder == 0, f"a notice moved value; {context}"  # I5
            if to_recipient:
                assert event == "authorize_release" and sender == "gate", f"the recipient was paid by something other than a gate release; {context}"  # I1, I9
            esc = expected.escrow
            stats["events"] += 1
            stats["refusals"] += bool(expected.refusal)
            stats["noops"] += bool(expected.noop)

        final = s.state()
        stats["terminal"][final] = stats["terminal"].get(final, 0) + 1
        stats["released"] += paid_recipient
        stats["returned"] += paid_funder
        if final in ("SETTLED", "RECLAIMED", "WITHDRAWN"):
            assert paid_recipient + paid_funder == amount, f"seed={seed} lifecycle={index}: a paying terminal state paid {paid_recipient + paid_funder}, not {amount}"
        else:
            assert paid_recipient + paid_funder == 0, f"seed={seed} lifecycle={index}: {final} has paid out"
        stats["lifecycles"] += 1
    return stats


@pytest.mark.parametrize("seed", SEEDS)
def test_random_lifecycles_agree_with_the_model_and_conserve_value(seed, direct_vm, direct_deploy, repo_root):
    stats = run_seed(seed, contract_path(repo_root, VAULT), direct_vm, direct_deploy)
    assert stats["lifecycles"] == LIFECYCLES
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    recorded = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else {"runs": {}}
    recorded["runs"][str(seed)] = stats
    recorded["generatedAt"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    recorded["build"] = os.environ.get("DEFINIT_CONTRACT_DIR", "readable (contracts/v1)")
    RESULTS.write_text(json.dumps(recorded, indent=2), encoding="utf-8")

"""Generate the Python side of the parity corpus.

The commitment encoding exists twice: in the contracts (Python) and in
lib/commitments/commitment.ts (TypeScript). This writes 240 seeded vectors
computed from the Python restatement in tests/v1/harness.py. The TypeScript
suite (tests/unit/parity.test.ts) recomputes every one of them, and the Python
suite (tests/v1/direct/test_parity.py) fails if this file is stale, so drift in
either implementation fails a test.
"""
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from v1.harness import evidence_digest_of, intent_hash, iso, keccak_hex  # noqa: E402


def addr(r):
    return "0x" + "".join(r.choice("0123456789abcdef") for _ in range(40))


def h32(r):
    return "0x" + "".join(r.choice("0123456789abcdef") for _ in range(64))


def vectors(seed=20261018, n=240):
    r = random.Random(seed)
    words = ["delivery", "partial", "damaged", "  spaced   out ", "line\nbreak", "tab\there", "unicode é ü", "PO #742", "approve", "ignore"]
    out = []
    for i in range(n):
        agent, recipient, policy = addr(r), addr(r), h32(r)
        amount = r.choice([1, 10, 10**16, r.randrange(1, 10**18), r.randrange(1, 2**63)])
        nonce = r.randrange(0, 2**40)
        deadline = r.randrange(1_700_000_000, 4_100_000_000)
        created = iso(r.randrange(1_700_000_000, 2_000_000_000))
        evidence = " ".join(r.choice(words) for _ in range(r.randrange(1, 30)))
        if i % 40 == 0:
            evidence = "x" * r.choice([19999, 20000, 20001, 25000])
        digest = evidence_digest_of(evidence)
        ih = intent_hash(agent, recipient, amount, "GEN", policy, digest, nonce, deadline)
        action = keccak_hex("|".join(("DEFINIT-ACTION-v1", "agent=" + agent, "recipient=" + recipient, "amount=" + str(amount), "asset=GEN", "policy_hash=" + policy, "nonce=" + str(nonce), "created_at=" + created)))
        attempt = r.randrange(1, 4)
        decided = iso(r.randrange(1_700_000_000, 2_000_000_000))
        decision = keccak_hex("|".join(("DEFINIT-DECISION-v2", "action=" + action, "attempt=" + str(attempt), "intent_hash=" + ih, "adjudicated_at=" + decided)))
        out.append({
            "agent": agent, "recipient": recipient, "amount": str(amount), "asset": "GEN", "policyHash": policy,
            "evidence": evidence, "evidenceDigest": digest, "nonce": nonce, "deadlineUnix": deadline,
            "createdAt": created, "intentHash": ih, "actionId": action, "attempt": attempt,
            "adjudicatedAt": decided, "decisionId": decision,
        })
    return out


if __name__ == "__main__":
    target = ROOT / "tests" / "v1" / "fixtures" / "parity-vectors.json"
    text = json.dumps({"seed": 20261018, "vectors": vectors()}, indent=1)
    if "--check" in sys.argv:
        sys.exit(0 if target.read_text(encoding="utf8") == text else 1)
    target.write_text(text, encoding="utf8")
    print(f"wrote {len(vectors())} vectors to {target}")

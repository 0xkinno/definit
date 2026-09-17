"""Smoke test: the three contracts deploy, wire and answer reads.

Written first and kept, because every stronger claim in this repository rests
on this working. If it is red, nothing downstream means anything.
"""

from __future__ import annotations

from gltest.assertions import tx_execution_succeeded


def test_registry_reports_the_published_policy(deployed):
    policy = deployed._read(deployed.registry, "get_policy", "delivery-milestone-v3")
    assert policy["exists"] is True
    assert policy["version"] == "3.0.0"
    assert policy["policy_hash"].startswith("0x")
    assert len(policy["policy_hash"]) == 66


def test_vault_is_bound_to_the_gate(deployed):
    described = deployed.describe("vault")
    assert described["gate"].lower() == deployed.gate.address.lower()
    assert described["escrow_asset"] == "GEN"


def test_gate_is_bound_to_both_peers(deployed):
    described = deployed.describe("gate")
    assert described["vault"].lower() == deployed.vault.address.lower()
    assert described["registry"].lower() == deployed.registry.address.lower()
    assert described["settlement_message_stage"] == "finalized"
    assert described["capability_read_scope"] == "FINALIZED_CAPABILITY"


def test_action_creation_derives_a_commitment(deployed):
    receipt = deployed.create_action(
        "0x00000000000000000000000000000000000000a1", nonce=8001
    )
    assert tx_execution_succeeded(receipt)

    action_id = deployed.action_id_for(deployed.owner)
    action = deployed.gate_state(action_id)

    assert action["exists"] is True
    assert action["state"] == "SUBMITTED"
    assert action["intent_hash"] == ""
    assert action["nonce"] == 8001


def test_unknown_action_is_an_explicit_absence(deployed):
    action = deployed.gate_state("0x" + "00" * 32)
    assert action["exists"] is False
    assert action["reason_code"] == "ACTION_UNKNOWN"

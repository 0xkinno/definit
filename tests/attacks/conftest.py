"""Direct-mode configuration for the attack suite.

Two bridges are installed before any contract is loaded: the class-name bridge
for the published runner's AST lookup, and the SDK bridge that resolves the
runner build against the toolchain installed on this machine. See
`tests/_sdk_compat.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_TESTS_DIR = Path(__file__).resolve().parents[1]
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

import _sdk_compat

_sdk_compat.install()

ROOT = Path(__file__).resolve().parents[2]

GATE = str(ROOT / "contracts" / "decision_gate.py")
VAULT = str(ROOT / "contracts" / "finality_vault.py")

# The vault and the registry are addressed but never called in these tests:
# every case below is decided by a guard that reads nothing but its own
# storage and the message context, which is what makes each one independently
# falsifiable here.
VAULT_ADDR = "0x00000000000000000000000000000000000000bb"
REGISTRY_ADDR = "0x00000000000000000000000000000000000000aa"

OWNER = "0x1111111111111111111111111111111111111111"
AGENT = "0x2222222222222222222222222222222222222222"
OUTSIDER = "0x3333333333333333333333333333333333333333"
RECIPIENT = "0x4444444444444444444444444444444444444444"


def as_sender(value: str) -> bytes:
    """Raw bytes for `direct_vm.sender`.

    The direct runner converts a `bytes` sender into an `Address` before the
    contract sees it, but leaves a `str` sender as a `str`. A contract that
    compares `gl.message.sender_address` against an `Address` therefore never
    matches a string sender -- which would make every "only the owner may do
    this" case pass for the wrong reason. Senders are pinned to bytes so the
    comparison is the one the contract actually performs.
    """
    return bytes.fromhex(value[2:] if value.startswith("0x") else value)


@pytest.fixture
def gate(direct_deploy):
    return direct_deploy(GATE, VAULT_ADDR, REGISTRY_ADDR)


@pytest.fixture
def vault(direct_deploy):
    """A vault whose owner is deliberately *not* the account running the test.

    The direct runner pins `gl.message` to the account that loaded the
    contract and does not re-resolve it when `direct_vm.sender` is reassigned,
    so a test cannot become the owner part-way through. Deploying with a
    foreign owner is therefore the only arrangement in which an ownership
    refusal is attributable to the ownership check rather than to a harness
    default. The positive path -- the owner binding the gate -- is exercised
    on chain and recorded in `docs/evidence/live-lifecycle.json`.
    """
    return direct_deploy(VAULT, OUTSIDER)

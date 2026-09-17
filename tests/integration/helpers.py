"""Deployment and lifecycle helpers shared by the integration suites.

Everything here exists to answer one question against a real node: does an
effect move only when the decision behind it has reached finality?

The published test client exposes each contract method as a callable that
returns a *function handle*, not a value: reads are executed with ``.call()``
and writes with ``.transact()``. Both are funnelled through ``_read`` and
``_write`` here so no test has to remember which is which.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"

DEMO_POLICY_ID = "delivery-milestone-v3"

# Amount escrowed in the demo journey. Small on purpose: it is test GEN, and
# the product claim is about *when* it moves, not how much.
DEMO_AMOUNT = 10


def demo_policy_text() -> str:
    text = (ROOT / "public" / "demo" / "policy-delivery-milestone-v3.txt").read_text(
        encoding="utf-8"
    )
    return text.rstrip("\n")


def satisfying_evidence() -> str:
    return (ROOT / "public" / "demo" / "delivery-742.txt").read_text(encoding="utf-8")


def contradicting_evidence() -> str:
    return (ROOT / "public" / "demo" / "delivery-742-partial.txt").read_text(
        encoding="utf-8"
    )


EVIDENCE_URL = "https://definit.test/demo/delivery-742.txt"


def web_context(body: str, status: int = 200) -> dict:
    """Build a `transaction_context` that answers the evidence fetch.

    The judgement is still made by the validators from the snapshot they
    receive; this only supplies the snapshot, standing in for an HTTPS host
    that is not running during the test.
    """
    return {
        "nondet_web_request": {
            EVIDENCE_URL: {"method": "GET", "status": status, "body": body}
        }
    }


@dataclass
class DefinitNetwork:
    """The three contracts, deployed and wired, on whatever network is active."""

    factory: Any
    registry: Any = None
    vault: Any = None
    gate: Any = None
    owner: str = ""
    addresses: dict = field(default_factory=dict)

    # ------------------------------------------------------- method plumbing

    @staticmethod
    def _read(contract: Any, method: str, *args: Any, variant: Any = None) -> Any:
        handle = getattr(contract, method)(args=list(args))
        if variant is None:
            return handle.call()
        return handle.call(transaction_hash_variant=variant)

    @staticmethod
    def _write(
        contract: Any,
        method: str,
        *args: Any,
        value: int = 0,
        **kwargs: Any,
    ) -> Any:
        return getattr(contract, method)(args=list(args)).transact(value=value, **kwargs)

    # ------------------------------------------------------------- deployment

    def deploy_all(self) -> "DefinitNetwork":
        from gltest import get_default_account

        self.owner = get_default_account().address

        self.registry = self.factory("ScenarioRegistry").deploy()
        self.vault = self.factory("FinalityVault").deploy(args=[self.owner])
        self.gate = self.factory("DecisionGate").deploy(
            args=[self.vault.address, self.registry.address]
        )
        self._write(self.vault, "set_gate", self.gate.address)

        self.addresses = {
            "scenarioRegistry": self.registry.address,
            "finalityVault": self.vault.address,
            "decisionGate": self.gate.address,
            "owner": self.owner,
        }
        return self

    def publish_demo_policy(self) -> str:
        return self._write(
            self.registry,
            "publish_policy",
            DEMO_POLICY_ID,
            "3.0.0",
            "Milestone payment",
            demo_policy_text(),
        )

    # ------------------------------------------------------------- journeys

    def create_action(
        self,
        recipient: str,
        *,
        nonce: int,
        amount: int = DEMO_AMOUNT,
        deadline_unix: Optional[int] = None,
        evidence_url: str = EVIDENCE_URL,
        policy_id: str = DEMO_POLICY_ID,
    ) -> dict:
        if deadline_unix is None:
            deadline_unix = int(time.time()) + 72 * 3600
        return self._write(
            self.gate,
            "create_action",
            recipient,
            amount,
            "GEN",
            policy_id,
            evidence_url,
            deadline_unix,
            nonce,
        )

    def action_id_for(self, sender: str) -> str:
        rows = self._read(self.gate, "list_actions_for", sender)
        return str(rows[-1]["action_id"])

    def open_escrow(self, action_id: str, amount: int = DEMO_AMOUNT) -> dict:
        return self._write(self.vault, "open_escrow", action_id, value=amount)

    def adjudicate(self, action_id: str, body: str) -> dict:
        return self._write(
            self.gate,
            "request_adjudication",
            action_id,
            transaction_context=web_context(body),
            wait_interval=2000,
            wait_retries=60,
        )

    def finalize(
        self,
        decision_id: str,
        wait_transaction_status: Any = None,
        wait_interval: int = 2000,
        wait_retries: int = 60,
    ) -> dict:
        """Promote an accepted decision and schedule the settlement message."""
        from gltest.types import TransactionStatus

        return self._write(
            self.gate,
            "finalize_decision",
            decision_id,
            wait_transaction_status=wait_transaction_status or TransactionStatus.FINALIZED,
            wait_interval=wait_interval,
            wait_retries=wait_retries,
        )

    def wait_for_receipt(self, action_id: str, attempts: int = 30) -> dict:
        """Poll the vault until the settlement receipt appears."""
        record = self.receipt(action_id)
        for _ in range(attempts):
            if record.get("exists"):
                return record
            time.sleep(2)
            record = self.receipt(action_id)
        return record

    # ------------------------------------------------------------- reads

    def gate_state(self, action_id: str) -> dict:
        return self._read(self.gate, "get_action", action_id)

    def escrow(self, action_id: str) -> dict:
        return self._read(self.vault, "get_escrow", action_id)

    def receipt(self, action_id: str) -> dict:
        return self._read(self.vault, "get_receipt", action_id)

    def capability(self, decision_id: str, final: bool) -> dict:
        from gltest.types import TransactionHashVariant

        variant = (
            TransactionHashVariant.LATEST_FINAL
            if final
            else TransactionHashVariant.LATEST_NONFINAL
        )
        return self._read(self.gate, "get_capability", decision_id, variant=variant)

    def describe(self, which: str) -> dict:
        return self._read({"gate": self.gate, "vault": self.vault, "registry": self.registry}[which], "describe")

    def dump(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.addresses, indent=2), encoding="utf-8")

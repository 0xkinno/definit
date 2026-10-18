"""Offline harness for the v1 contracts.

The direct VM runs one contract at a time and answers a cross-contract call
with nothing. This harness installs the VM's own cross-contract hook so that:

* a view call to another contract is answered from a table the test controls
  (a "world"), and
* every message a contract emits is recorded with its stage, target, method and
  arguments, so a test can assert what the gate emitted and then deliver that
  exact message to a real vault with the gate as sender.

That second part is the point. Release authority in v1 is a delivery, so the
guards that matter take their input as calldata plus a sender, and both can be
supplied here without a network.

Nothing in this file decides anything about the contracts under test.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


def contract_path(repo_root: Any, relative: str) -> str:
    """Where a contract under test lives.

    By default the readable source in the repository. DEFINIT_CONTRACT_DIR points the
    suite at another directory holding the same file names: the minified build, or a
    mutant the mutation check has written. The file name decides which contract.
    """
    import os
    from pathlib import Path

    override = os.environ.get("DEFINIT_CONTRACT_DIR")
    if override:
        name = Path(relative).name
        variant = os.environ.get("DEFINIT_CONTRACT_SUFFIX", "")
        candidate = Path(override) / (name[:-3] + variant + ".py" if variant else name)
        if candidate.exists():
            return str(candidate)
        raise FileNotFoundError(f"DEFINIT_CONTRACT_DIR is set but {candidate} does not exist")
    return str(Path(repo_root) / relative)


def addr_hex(value: Any) -> str:
    if isinstance(value, (bytes, bytearray)):
        return "0x" + bytes(value).hex()
    if hasattr(value, "as_bytes"):
        return "0x" + value.as_bytes.hex()
    return str(value).lower()


def to_bytes(hex_address: str) -> bytes:
    return bytes.fromhex(hex_address[2:] if hex_address.startswith("0x") else hex_address)


@dataclass
class Emitted:
    stage: str
    target: str
    method: str
    args: list
    value: int = 0
    raw: dict = field(default_factory=dict)


class World:
    """A table of cross-contract view answers and a log of emitted messages."""

    def __init__(self, vm: Any) -> None:
        self.vm = vm
        self.views: dict[tuple[str, str], Callable[..., Any]] = {}
        self.emitted: list[Emitted] = []
        self.view_calls: list[tuple[str, str, list]] = []
        self.unknown: list[dict] = []
        vm._gl_call_hook = self._hook

    # -- configuration ---------------------------------------------------
    def answer(self, address: str, method: str, fn: Callable[..., Any] | Any) -> None:
        self.views[(address.lower(), method)] = fn if callable(fn) else (lambda *_a, _v=fn: _v)

    def set_time(self, iso: str) -> None:
        """Move the chain clock the contracts read (gl.message.datetime).

        vm.warp() patches datetime.now() but leaves gl.message.datetime alone,
        and the contracts stamp and compare against the latter.
        """
        import sys

        self.vm.warp(iso)
        message = sys.modules.get("genlayer.message")
        if message is not None:
            message.datetime = iso
            raw = getattr(message, "raw", None)
            if isinstance(raw, dict):
                raw["datetime"] = iso

    # -- hook ------------------------------------------------------------
    def _hook(self, vm: Any, request: dict) -> Any:
        if "CallContract" in request:
            from genlayer import calldata

            data = request["CallContract"]
            target = addr_hex(data["address"])
            body = data.get("calldata", {})
            method = body.get("") or body.get("method")
            args = list(body.get("args", []))
            self.view_calls.append((target, method, args))
            fn = self.views.get((target, method))
            if fn is None:
                return bytes([1]) + f"no view {method} at {target}".encode()
            return bytes([0]) + calldata.encode(fn(*args))

        for key in ("EmitInternalMessage", "PostMessage"):
            if key in request:
                data = request[key]
                body = data.get("calldata", {})
                stage = "finalized"
                on = data.get("on") or data.get("stage") or data.get("when")
                if on is not None:
                    stage = str(on)
                self.emitted.append(
                    Emitted(
                        stage=stage,
                        target=addr_hex(data["address"]),
                        method=body.get("") or body.get("method"),
                        args=list(body.get("args", [])),
                        value=int(data.get("value", 0) or 0),
                        raw={k: v for k, v in data.items() if k != "code"},
                    )
                )
                return {"ok": None}

        self.unknown.append(request)
        return None

    # -- convenience -----------------------------------------------------
    def messages_to(self, method: str) -> list[Emitted]:
        return [m for m in self.emitted if m.method == method]


# ---------------------------------------------------------------- scenarios

OWNER = "0x" + "11" * 20
GATE = "0x" + "22" * 20
FUNDER = "0x" + "33" * 20
RECIPIENT = "0x" + "44" * 20
STRANGER = "0x" + "55" * 20
ACTOR = {"owner": OWNER, "gate": GATE, "funder": FUNDER, "recipient": RECIPIENT, "stranger": STRANGER}

POLICY_HASH = "0x" + "9a" * 32
EVIDENCE_DIGEST = "0x" + "ab" * 32
DEADLINE = 4_000_000_000
NOW = "2026-10-17T12:00:00Z"
LATE = "2099-01-01T00:00:00Z"
AMOUNT = 5_000


def iso(unix_seconds: int) -> str:
    """An ISO-8601 UTC instant for a unix time, so tests never hand-convert one."""
    import datetime

    return datetime.datetime.fromtimestamp(unix_seconds, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def keccak_hex(payload: str) -> str:
    from Crypto.Hash import keccak

    h = keccak.new(digest_bits=256)
    h.update(payload.encode("utf-8"))
    return "0x" + h.hexdigest()


def intent_hash(agent: str, recipient: str, amount: int, asset: str, policy_hash: str, evidence_digest: str, nonce: int, deadline: int) -> str:
    """The v0 commitment encoding, restated independently of the contract."""
    return keccak_hex(
        "|".join(
            (
                "DEFINIT-COMMITMENT-v1",
                "agent=" + agent,
                "recipient=" + recipient,
                "amount=" + str(amount),
                "asset=" + asset,
                "policy_hash=" + policy_hash,
                "evidence_digest=" + evidence_digest,
                "nonce=" + str(nonce),
                "deadline=" + str(deadline),
            )
        )
    )


class RevertedWith(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class Scenario:
    """One vault, one bound gate, one funder, driven by named actors."""

    def __init__(self, vm: Any, deploy: Callable[..., Any], vault_path: str) -> None:
        self.vm = vm
        self.world = World(vm)
        self.action_id = golden()["action_id"]
        self.nonce = 7
        self.asset = "GEN"
        self.deploy_vault(deploy, vault_path)
        self.world.set_time(NOW)

    # -- setup -----------------------------------------------------------
    def deploy_vault(self, deploy: Callable[..., Any], vault_path: str) -> None:
        self.vm.sender = to_bytes(OWNER)
        self.vault = deploy(vault_path, OWNER)

    def bind_gate(self) -> dict:
        return self.call("owner", "set_gate", GATE)

    def teach_gate_the_action(self, **over: Any) -> None:
        action = {
            "exists": True,
            "agent": FUNDER,
            "recipient": RECIPIENT,
            "amount": AMOUNT,
            "asset": self.asset,
            "policy_hash": POLICY_HASH,
            "nonce": self.nonce,
            "deadline_unix": DEADLINE,
        }
        action.update(over)
        self.world.answer(GATE, "get_action", lambda _aid, _a=action: _a)

    # -- calls -----------------------------------------------------------
    def call(self, who: str, method: str, *args: Any, value: int = 0) -> Any:
        self.vm.sender = to_bytes(ACTOR.get(who, who))
        self.vm.value = value
        try:
            return getattr(self.vault, method)(*args)
        except Exception as error:  # ContractUserError carries the contract's refusal code
            code = getattr(error, "args", [""])[0] if error.args else ""
            if type(error).__name__ == "ContractUserError":
                raise RevertedWith(str(code)) from error
            raise
        finally:
            self.vm.value = 0

    def fund(self, who: str = "funder", **over: Any) -> dict:
        fields = {
            "action_id": self.action_id,
            "recipient": RECIPIENT,
            "amount": AMOUNT,
            "asset": self.asset,
            "policy_hash": POLICY_HASH,
            "nonce": self.nonce,
            "deadline_unix": DEADLINE,
        }
        value = over.pop("value", None)
        fields.update(over)
        return self.call(who, "open_escrow", *fields.values(), value=AMOUNT if value is None else value)

    def ready(self) -> "Scenario":
        """Gate bound, the gate knows the action, an escrow is open."""
        self.bind_gate()
        self.teach_gate_the_action()
        self.fund()
        return self

    def release_args(self, **over: Any) -> dict:
        digest = over.get("evidence_digest", EVIDENCE_DIGEST)
        fields = {
            "action_id": self.action_id,
            "decision_id": golden()["decision_id"],
            "intent_hash": None,
            "evidence_digest": digest,
            "policy_hash": POLICY_HASH,
            "nonce": self.nonce,
            "recipient": RECIPIENT,
            "amount": AMOUNT,
        }
        fields.update(over)
        if fields["intent_hash"] is None:
            fields["intent_hash"] = intent_hash(FUNDER, RECIPIENT, AMOUNT, self.asset, POLICY_HASH, digest, self.nonce, DEADLINE)
        return fields

    def deliver_release(self, who: str = "gate", **over: Any) -> dict:
        return self.call(who, "authorize_release", *self.release_args(**over).values())

    def deliver_refusal(self, who: str = "gate", reason: str = "EVIDENCE_MISSING") -> dict:
        return self.call(who, "close_refused", self.action_id, "0x" + "d2" * 32, reason)

    def deliver_note(self, who: str = "gate", verdict: str = "APPROVE") -> dict:
        return self.call(who, "note_provisional", self.action_id, "0x" + "d3" * 32, verdict)

    # -- observation -----------------------------------------------------
    def escrow(self) -> dict:
        return self.vault.get_escrow(self.action_id)

    def state(self) -> str:
        return self.escrow()["state"]

    def transfers(self) -> list[Emitted]:
        return [m for m in self.world.emitted if m.method is None and m.value > 0]

    def transferred_to(self, who: str) -> int:
        target = ACTOR.get(who, who)
        return sum(m.value for m in self.transfers() if m.target == target)

    def describe(self) -> dict:
        return self.vault.describe()


# -------------------------------------------------------------------- gate

VAULT_ADDR = "0x" + "bb" * 20
REGISTRY_ADDR = "0x" + "aa" * 20
AGENT = FUNDER
POLICY_ID = "delivery-milestone-v3"
POLICY_VERSION = "3.0.0"
POLICY_TEXT = "R1. The evidence must name the purchase order."
EVIDENCE_URL = "https://example.invalid/evidence.txt"
EVIDENCE_TEXT = "DELIVERY CONFIRMATION RECORD  Consignment NW-742-DEL  Purchase order PO-742  Delivered"
APPROVE_JSON = '{"verdict": "APPROVE", "reason_code": "EVIDENCE_SATISFIES_POLICY", "confidence": 93, "note": "ok"}'
REJECT_JSON = '{"verdict": "REJECT", "reason_code": "EVIDENCE_MISSING", "confidence": 71, "note": "no PO"}'


def evidence_digest_of(text: str) -> str:
    """The digest the gate derives from the snapshot it saw (whitespace-normalised, v0 domain)."""
    return keccak_hex("DEFINIT-EVIDENCE-v1|" + " ".join(text.split())[:20000])


def install_text_llm_mock() -> None:
    """Make a mocked LLM answer arrive as text, as it does on chain.

    The published mock parses a JSON answer into a dict, but the SDK's
    exec_prompt(response_format="json") expects text and parses it itself, so
    the mocked path fails with "JSON result is not text" before the contract's
    own logic runs. This hands the contract the same shape the network does.
    """
    from gltest.direct import wasi_mock

    if getattr(wasi_mock, "_definit_text_llm", False):
        return

    def handler(vm: Any, data: Any) -> Any:
        prompt = data.get("prompt", "")
        response = vm._match_llm_mock(prompt)
        if response is None:
            raise wasi_mock.MockNotFoundError(f"No LLM mock for prompt: {prompt[:100]}...")
        if not isinstance(response, (str, bytes)):
            import json

            response = json.dumps(response)
        return {"ok": response}

    wasi_mock._handle_llm_request = handler
    wasi_mock._definit_text_llm = True


def golden() -> dict:
    """The message the gate must emit for the canonical scenario, computed with no help from the contracts.

    The gate suite asserts the gate emits exactly this. The vault suite delivers
    exactly this and expects a release. Neither contract is run in the other's
    VM (the runner holds one contract per VM), so this shared vector is what
    proves the two agree on every field.
    """
    action_id = keccak_hex(
        "|".join(
            (
                "DEFINIT-ACTION-v1",
                "agent=" + AGENT,
                "recipient=" + RECIPIENT,
                "amount=" + str(AMOUNT),
                "asset=GEN",
                "policy_hash=" + POLICY_HASH,
                "nonce=7",
                "created_at=" + NOW,
            )
        )
    )
    digest = evidence_digest_of(EVIDENCE_TEXT)
    ih = intent_hash(AGENT, RECIPIENT, AMOUNT, "GEN", POLICY_HASH, digest, 7, DEADLINE)
    decision_id = keccak_hex(
        "|".join(("DEFINIT-DECISION-v2", "action=" + action_id, "attempt=1", "intent_hash=" + ih, "adjudicated_at=" + NOW))
    )
    return {
        "action_id": action_id,
        "decision_id": decision_id,
        "intent_hash": ih,
        "evidence_digest": digest,
        "args": [action_id, decision_id, ih, digest, POLICY_HASH, 7, RECIPIENT, AMOUNT],
    }


class GateScenario:
    """The decision contract with its registry and vault answered by a world."""

    def __init__(self, vm: Any, deploy: Callable[..., Any], gate_path: str) -> None:
        install_text_llm_mock()
        self.vm = vm
        self.world = World(vm)
        vm.sender = to_bytes(OWNER)
        self.gate = deploy(gate_path, VAULT_ADDR, REGISTRY_ADDR)
        self.world.set_time(NOW)
        self.world.answer(
            REGISTRY_ADDR,
            "get_policy",
            lambda pid: {
                "exists": pid == POLICY_ID,
                "policy_id": pid,
                "version": POLICY_VERSION,
                "title": "t",
                "text": POLICY_TEXT,
                "policy_hash": POLICY_HASH,
                "reason_code": "",
            },
        )
        self.fund_state("OPEN")
        self.action_id = None

    def fund_state(self, state: str | None) -> None:
        """What the gate sees when it asks the vault about the escrow."""
        if state is None:
            self.world.answer(VAULT_ADDR, "get_escrow", {"exists": False, "state": ""})
        else:
            self.world.answer(VAULT_ADDR, "get_escrow", {"exists": True, "state": state})

    def call(self, who: str, method: str, *args: Any) -> Any:
        self.vm.sender = to_bytes(ACTOR.get(who, who))
        try:
            return getattr(self.gate, method)(*args)
        except Exception as error:
            if type(error).__name__ == "ContractUserError":
                raise RevertedWith(str(error.args[0]) if error.args else "") from error
            raise

    def create(self, who: str = "funder", **over: Any) -> str:
        fields = {
            "recipient": RECIPIENT,
            "amount": AMOUNT,
            "asset": "GEN",
            "policy_id": POLICY_ID,
            "evidence_url": EVIDENCE_URL,
            "deadline_unix": DEADLINE,
            "nonce": 7,
        }
        fields.update(over)
        action_id = self.call(who, "create_action", *fields.values())
        self.action_id = action_id
        return action_id

    def mock_evidence(self, text: str | None = EVIDENCE_TEXT, verdict_json: str = APPROVE_JSON) -> None:
        self.vm.clear_mocks()
        self.vm.mock_web("example.invalid", {"method": "GET", "status": 200, "body": text or ""})
        self.vm.mock_llm(".*", verdict_json)

    def adjudicate(self, who: str = "funder", action_id: str | None = None) -> dict:
        return self.call(who, "request_adjudication", action_id or self.action_id)

    def messages(self) -> list[Emitted]:
        return [m for m in self.world.emitted if m.method is not None]

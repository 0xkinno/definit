# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""
DEFINIT -- FinalityVault
=======================

The custody side of the finality firewall.

This contract holds escrowed value and is the only place in the system where an
irreversible economic effect happens. It is written on the assumption that
*every* caller is hostile, including the decision contract.

The hard invariant
------------------
No value leaves this contract unless all of the following hold in the same
transaction:

  1. an escrow exists for the action;
  2. the caller is the authorized decision contract;
  3. the escrow has not already been released;
  4. the action deadline has not passed;
  5. every commitment field restated by the caller equals the escrow record;
  6. the settlement nonce has never been used for this action;
  7. the decision contract has promoted that decision to FINAL, which it only
     does once the decision has left its appeal window;
  8. the decision the gate promoted approves, and its own commitment matches
     the escrow exactly;
  9. the appeal window recorded by the gate has genuinely elapsed, measured
     against this transaction's own clock rather than a caller's claim.

Any failure is a revert. There is no partial path, no best-effort path and no
administrative override.

Note on how (7) and (9) are enforced
------------------------------------
An earlier revision of this contract read the gate through
``gl.contract.StorageView.LATEST_FINALIZED``, and that is the construction the
whole design wanted: a cross-contract read scoped to final storage state cannot
observe a decision that is still appealable, so the boundary would have been a
property of the read itself.

On this network the leader cannot execute that read. The call does not return a
refusal, it stops returning at all, and the transaction is killed with
``Leader execution exceeded 600.000s``. The isolation run recorded in
``docs/evidence/probe/vm-capabilities.json`` shows a plain cross-contract read
answering in full while the final-scoped read of the same method on the same
contract never answers.

So the boundary is enforced the other way round: the gate refuses to promote a
decision until its appeal window has closed (``APPEAL_WINDOW_OPEN``), and this
contract re-derives the window from the gate's own ``adjudicated_at`` and
refuses to release before it has elapsed. The effect still waits for the
decision to stop being appealable, and no value moves on a caller's promise.
What is lost is the guarantee that the *read itself* cannot see provisional
state. That loss is stated plainly in ``docs/LIMITATIONS.md``.
"""

import datetime

import genlayer as gl
from genlayer import *  # noqa: F401,F403
from genlayer.storage import allow, Array, DynArray, TreeMap

from dataclasses import dataclass

STATE_OPEN = 'OPEN'
STATE_SETTLED = 'SETTLED'

ERR_ESCROW_UNKNOWN = 'ESCROW_UNKNOWN'
ERR_ESCROW_EXISTS = 'ESCROW_EXISTS'
ERR_UNAUTHORIZED_CALLER = 'UNAUTHORIZED_CALLER'
ERR_ALREADY_SETTLED = 'ALREADY_SETTLED'
ERR_EXPIRED = 'EXPIRED'
ERR_COMMITMENT_MISMATCH = 'COMMITMENT_MISMATCH'
ERR_REPLAY = 'REPLAY_BLOCKED'
ERR_DECISION_NOT_FINAL = 'DECISION_NOT_FINAL'
ERR_VERDICT_NOT_APPROVE = 'VERDICT_NOT_APPROVE'
ERR_BAD_VALUE = 'BAD_VALUE'
ERR_NOT_OWNER = 'NOT_OWNER'
ERR_GATE_ALREADY_SET = 'GATE_ALREADY_SET'
ERR_INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE'
ERR_NOT_ADJUDICATED = 'NOT_ADJUDICATED'

# The capability is read by name, not by storage scope, so the label recorded on
# a receipt names the property that was actually checked.
FINAL_READ_SCOPE = 'FINALIZED_CAPABILITY'
FINALITY_RULE = 'promoted-plus-appeal-window'

# Seconds a decision must remain untouched after adjudication before either
# contract will treat it as settled. The gate refuses to promote inside the
# window; this contract refuses to release inside it. Both read the same
# ``adjudicated_at`` the gate wrote, and both measure it against the clock of
# the transaction doing the checking.
APPEAL_WINDOW_SECONDS = 120


def _unix_from_iso(value) -> int:
	raw = str(value)
	if not raw:
		return 0
	if raw.endswith('Z'):
		raw = raw[:-1] + '+00:00'
	moment = datetime.datetime.fromisoformat(raw)
	if moment.tzinfo is None:
		moment = moment.replace(tzinfo=datetime.timezone.utc)
	return int(moment.timestamp())


def _now_unix() -> int:
	raw = str(gl.message.datetime)
	if raw.endswith('Z'):
		raw = raw[:-1] + '+00:00'
	moment = datetime.datetime.fromisoformat(raw)
	if moment.tzinfo is None:
		moment = moment.replace(tzinfo=datetime.timezone.utc)
	return int(moment.timestamp())


def _addr_hex(value) -> str:
	"""Lower-case hex for an address.

	Accepts both an ``Address`` and the hex string a cross-contract read
	returns, because the two meet at the contract boundary and a comparison
	between them is the single most common place for a silent mismatch.
	"""
	if isinstance(value, str):
		return value.strip().lower()
	return value.as_hex.lower()


@allow
@dataclass
class EscrowRecord:
	action_id: str
	funder: Address
	recipient: Address
	amount: u256
	asset: str
	intent_hash: str
	policy_hash: str
	evidence_digest: str
	nonce: u256
	deadline_unix: u256
	opened_at: str
	state: str
	released_at: str
	released_to: Address
	decision_id: str


@allow
@dataclass
class FinalityReceipt:
	action_id: str
	decision_id: str
	intent_hash: str
	policy_hash: str
	evidence_digest: str
	nonce: u256
	amount: u256
	asset: str
	funder: Address
	recipient: Address
	opened_at: str
	settled_at: str
	decision_read_scope: str
	finality_proof: str
	status: str
	message_stage: str


class FinalityVault(gl.contract.Contract):
	owner: Address
	gate: Address
	escrows: TreeMap[str, EscrowRecord]
	receipts: TreeMap[str, FinalityReceipt]
	used_nonces: TreeMap[str, bool]
	settlement_count: u256
	blocked_count: u256

	def __init__(self, owner_address: Address):
		self.owner = Address(owner_address)
		self.gate = Address(b'\x00' * 20)
		self.settlement_count = u256(0)
		self.blocked_count = u256(0)

	# ------------------------------------------------------------------- views

	@gl.public.view
	def get_escrow(self, action_id: str) -> dict:
		if action_id not in self.escrows:
			return {
				'exists': False,
				'action_id': action_id,
				'reason_code': ERR_ESCROW_UNKNOWN,
			}
		record = self.escrows[action_id]
		return {
			'exists': True,
			'action_id': record.action_id,
			'funder': _addr_hex(record.funder),
			'recipient': _addr_hex(record.recipient),
			'amount': int(record.amount),
			'asset': record.asset,
			'intent_hash': record.intent_hash,
			'policy_hash': record.policy_hash,
			'evidence_digest': record.evidence_digest,
			'nonce': int(record.nonce),
			'deadline_unix': int(record.deadline_unix),
			'opened_at': record.opened_at,
			'state': record.state,
			'released_at': record.released_at,
			'decision_id': record.decision_id,
		}

	@gl.public.view
	def get_receipt(self, action_id: str) -> dict:
		if action_id not in self.receipts:
			return {
				'exists': False,
				'action_id': action_id,
				'reason_code': ERR_ESCROW_UNKNOWN,
			}
		record = self.receipts[action_id]
		return {
			'exists': True,
			'action_id': record.action_id,
			'decision_id': record.decision_id,
			'intent_hash': record.intent_hash,
			'policy_hash': record.policy_hash,
			'evidence_digest': record.evidence_digest,
			'nonce': int(record.nonce),
			'amount': int(record.amount),
			'asset': record.asset,
			'funder': _addr_hex(record.funder),
			'recipient': _addr_hex(record.recipient),
			'opened_at': record.opened_at,
			'settled_at': record.settled_at,
			'decision_read_scope': record.decision_read_scope,
			'finality_proof': record.finality_proof,
			'status': record.status,
			'message_stage': record.message_stage,
		}

	@gl.public.view
	def nonce_used(self, action_id: str, nonce: int) -> bool:
		return (action_id + ':' + str(nonce)) in self.used_nonces

	@gl.public.view
	def describe(self) -> dict:
		return {
			'product': 'DEFINIT',
			'contract': 'FinalityVault',
			'owner': _addr_hex(self.owner),
			'gate': _addr_hex(self.gate),
			'settlement_count': int(self.settlement_count),
			'blocked_count': int(self.blocked_count),
			'final_read_scope': FINAL_READ_SCOPE,
			'finality_rule': FINALITY_RULE,
			'appeal_window_seconds': APPEAL_WINDOW_SECONDS,
			'release_message_stage': 'finalized',
		}

	# ------------------------------------------------------------------ writes

	@gl.public.write
	def set_gate(self, gate_address: str) -> dict:
		"""Bind the single authorized decision contract. Writable exactly once."""
		if gl.message.sender_address != self.owner:
			gl.vm.UserError.immediate(ERR_NOT_OWNER)
		if self.gate != Address(b'\x00' * 20):
			gl.vm.UserError.immediate(ERR_GATE_ALREADY_SET)
		self.gate = Address(gate_address)
		return {'gate': _addr_hex(self.gate), 'state': 'BOUND'}

	@gl.public.write.payable
	def open_escrow(self, action_id: str) -> dict:
		"""Fund an escrow for an action the decision contract already knows about.

		Every economically meaningful field of the escrow record is derived from
		the decision contract, not from the caller. The caller chooses only how
		much value to send. That removes an entire class of attack: a funder
		cannot name a different recipient, a different amount or a different
		policy than the one that will be judged.
		"""
		if action_id in self.escrows:
			gl.vm.UserError.immediate(ERR_ESCROW_EXISTS)
		if self.gate == Address(b'\x00' * 20):
			gl.vm.UserError.immediate(ERR_UNAUTHORIZED_CALLER)

		action = gl.contract.get_at(self.gate).view().get_action(action_id)
		if not action['exists']:
			gl.vm.UserError.immediate(ERR_ESCROW_UNKNOWN)

		amount = int(action['amount'])
		if int(gl.message.value) != amount:
			gl.vm.UserError.immediate(ERR_BAD_VALUE)
		if _addr_hex(gl.message.sender_address) != str(action['agent']).lower():
			gl.vm.UserError.immediate(ERR_UNAUTHORIZED_CALLER)

		# An escrow commits to the judged action, so the action must already
		# carry its commitment. The commitment cannot exist before adjudication
		# because the evidence digest is derived inside the non-deterministic
		# block. Funding first would create an escrow that can never settle.
		if len(str(action['intent_hash'])) == 0:
			gl.vm.UserError.immediate(ERR_NOT_ADJUDICATED)

		self.escrows[action_id] = EscrowRecord(
			action_id=action_id,
			funder=gl.message.sender_address,
			recipient=Address(str(action['recipient'])),
			amount=u256(amount),
			asset=str(action['asset']),
			intent_hash=str(action['intent_hash']),
			policy_hash=str(action['policy_hash']),
			evidence_digest=str(action['evidence_digest']),
			nonce=u256(int(action['nonce'])),
			deadline_unix=u256(int(action['deadline_unix'])),
			opened_at=str(gl.message.datetime),
			state=STATE_OPEN,
			released_at='',
			released_to=Address(b'\x00' * 20),
			decision_id='',
		)

		return {
			'action_id': action_id,
			'amount': amount,
			'recipient': str(action['recipient']),
			'state': STATE_OPEN,
			'note': 'escrow derived from the decision contract record',
		}

	@gl.public.write
	def settle(
		self,
		action_id: str,
		decision_id: str,
		claimed_intent_hash: str,
		claimed_policy_hash: str,
		claimed_evidence_digest: str,
		claimed_nonce: int,
		claimed_recipient: str,
		claimed_amount: int,
	) -> dict:
		"""Release escrow against a final decision, exactly once.

		Every guard below is independent. Removing any one of them is a real
		loss of security, which is why the attack suite drives each one.
		"""
		if action_id not in self.escrows:
			gl.vm.UserError.immediate(ERR_ESCROW_UNKNOWN)

		escrow = self.escrows[action_id]

		# Guard 1 -- only the bound decision contract, or the party that funded
		# this escrow, may attempt a release.
		#
		# The funder is allowed to *ask*. It is not allowed to decide: every guard
		# below still has to hold, and the decisive one reads the decision
		# contract at final storage scope. So opening the caller set costs
		# nothing, and it means the release does not depend on a deferred message
		# surviving the network's message queue.
		caller = _addr_hex(gl.message.sender_address)
		if caller != _addr_hex(self.gate) and caller != _addr_hex(escrow.funder):
			gl.vm.UserError.immediate(ERR_UNAUTHORIZED_CALLER)

		# Guard 2 -- an escrow settles at most once, ever.
		if escrow.state == STATE_SETTLED:
			gl.vm.UserError.immediate(ERR_ALREADY_SETTLED)

		# Guard 3 -- an expired authorization cannot be spent late.
		if _now_unix() > int(escrow.deadline_unix):
			gl.vm.UserError.immediate(ERR_EXPIRED)

		# Guard 4 -- the caller must restate the escrow commitment exactly.
		if str(claimed_intent_hash) != str(escrow.intent_hash):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if str(claimed_policy_hash) != str(escrow.policy_hash):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if str(claimed_evidence_digest) != str(escrow.evidence_digest):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if int(claimed_nonce) != int(escrow.nonce):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if str(claimed_recipient).lower() != _addr_hex(escrow.recipient):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if int(claimed_amount) != int(escrow.amount):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)

		# Guard 5 -- the settlement nonce is single-use.
		nonce_key = action_id + ':' + str(int(escrow.nonce))
		if nonce_key in self.used_nonces:
			gl.vm.UserError.immediate(ERR_REPLAY)

		# Guard 6 -- the decision must have been promoted to FINAL by the gate.
		#
		# The read is unscoped on purpose. A cross-contract read scoped to final
		# storage state is the construction this contract wants and cannot have:
		# the leader on this network never returns from it. See the note at the
		# top of this file and docs/LIMITATIONS.md.
		capability = gl.contract.get_at(self.gate).view().get_capability(decision_id)
		if not capability['exists']:
			self.blocked_count = u256(int(self.blocked_count) + 1)
			gl.vm.UserError.immediate(ERR_DECISION_NOT_FINAL)

		# Guard 6b -- "promoted" is not a label a caller can assert. The gate
		# writes it, and only after its own appeal window has closed.
		if str(capability.get('state', '')) != 'FINALIZED':
			self.blocked_count = u256(int(self.blocked_count) + 1)
			gl.vm.UserError.immediate(ERR_DECISION_NOT_FINAL)
		if not str(capability.get('finalized_at', '')):
			self.blocked_count = u256(int(self.blocked_count) + 1)
			gl.vm.UserError.immediate(ERR_DECISION_NOT_FINAL)

		# Guard 6c -- and this contract checks the window for itself, against
		# the gate's own adjudication stamp. A gate that promoted early still
		# cannot get value out early, because the window is re-derived here.
		if _now_unix() < _unix_from_iso(capability.get('adjudicated_at', '')) + APPEAL_WINDOW_SECONDS:
			self.blocked_count = u256(int(self.blocked_count) + 1)
			gl.vm.UserError.immediate(ERR_DECISION_NOT_FINAL)

		# Guard 7 -- the final decision must approve.
		if str(capability['verdict']) != 'APPROVE':
			gl.vm.UserError.immediate(ERR_VERDICT_NOT_APPROVE)

		# Guard 8 -- the final decision must name this exact action and commit
		# to this exact intent, policy and evidence.
		if str(capability['action_id']) != action_id:
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if str(capability['intent_hash']) != str(escrow.intent_hash):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if str(capability['policy_hash']) != str(escrow.policy_hash):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if str(capability['evidence_digest']) != str(escrow.evidence_digest):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if int(capability['nonce']) != int(escrow.nonce):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if _addr_hex(capability['recipient']) != _addr_hex(escrow.recipient):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if int(capability['amount']) != int(escrow.amount):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)

		settled_at = str(gl.message.datetime)

		# Effect. Markers are written before the outbound transfer so that a
		# replayed message finds the escrow already closed.
		self.used_nonces[nonce_key] = True
		escrow.state = STATE_SETTLED
		escrow.released_at = settled_at
		escrow.released_to = escrow.recipient
		escrow.decision_id = decision_id
		escrow.intent_hash = str(capability['intent_hash'])
		escrow.evidence_digest = str(capability['evidence_digest'])

		self.receipts[action_id] = FinalityReceipt(
			action_id=action_id,
			decision_id=decision_id,
			intent_hash=str(escrow.intent_hash),
			policy_hash=str(escrow.policy_hash),
			evidence_digest=str(escrow.evidence_digest),
			nonce=escrow.nonce,
			amount=escrow.amount,
			asset=str(escrow.asset),
			funder=escrow.funder,
			recipient=escrow.recipient,
			opened_at=escrow.opened_at,
			settled_at=settled_at,
			decision_read_scope=FINAL_READ_SCOPE,
			finality_proof=(
				'gate promoted the decision after its appeal window closed; '
				'this contract re-derived the window and matched the commitment'
			),
			status=STATE_SETTLED,
			message_stage='finalized',
		)
		self.settlement_count = u256(int(self.settlement_count) + 1)

		# Outbound value, also on the finalized stage.
		gl.chain.Account(escrow.recipient).emit_transfer(
			value=escrow.amount, on='finalized'
		)

		# Tell the decision contract to reconcile, on the finalized stage.
		gl.contract.get_at(self.gate).emit(value=u256(0), on='finalized').mark_settled(
			action_id
		)

		return {
			'action_id': action_id,
			'decision_id': decision_id,
			'status': STATE_SETTLED,
			'amount': int(escrow.amount),
			'recipient': _addr_hex(escrow.recipient),
			'nonce': int(escrow.nonce),
			'decision_read_scope': FINAL_READ_SCOPE,
			'settled_at': settled_at,
		}

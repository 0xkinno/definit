# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""
DEFINIT v2 -- FinalityVault
===========================

The custody side. It holds escrowed value and is the only place an irreversible
economic effect happens. It is written on the assumption that every caller is
hostile, including the decision contract.

The claim
---------
No value leaves this contract unless the protocol has delivered a finalized
approval from the deciding transaction, and no value is ever stranded.

Release authority is a delivery
-------------------------------
`authorize_release` is callable only by a message whose sender is the bound
gate (I1). That message exists only because the gate's adjudicating transaction
emitted it on the finalized stage and survived its appeal window. This contract
takes no decision from a cross-contract read of the gate. It checks the
delivered calldata against its own escrow record and recomputes the commitment
itself (I3).

There is no public method that releases value on a caller's request. The v1
path that let the funder trigger a release is gone.

Liveness
--------
Moving authority onto delivery creates a failure v1 did not have: if the
finalized child never arrives or fails at execution, the escrow would have no
way out (spike E4b). Two paths close that, and both only ever send value back to
the funder:

* `reclaim_after_deadline` -- the funder, after `deadline_unix`, while the escrow
  is still OPEN;
* `withdraw_refund` -- the funder, after a finalized refusal or a late delivery.

Time may only authorize a return to the funder, never a release to the
recipient (I9). Whichever of a finalized release and a reclaim executes first
wins; the other is a recorded no-op, so no ordering can produce two transfers
(I11).

State machine: docs/milestone/VAULT_STATE_MACHINE.md
"""

import json
import datetime

import genlayer as gl
from genlayer import *  # noqa: F401,F403
from genlayer.storage import TreeMap

COMMITMENT_DOMAIN = 'DEFINIT-COMMITMENT-v1'

STATE_OPEN = 'OPEN'
STATE_SETTLED = 'SETTLED'
STATE_REFUNDABLE = 'REFUNDABLE'
STATE_EXPIRED_REFUNDABLE = 'EXPIRED_REFUNDABLE'
STATE_RECLAIMED = 'RECLAIMED'
STATE_WITHDRAWN = 'WITHDRAWN'

MARK_NONE = ''
MARK_PROVISIONAL_APPROVE = 'PROVISIONAL_APPROVE'
MARK_PROVISIONAL_REJECT = 'PROVISIONAL_REJECT'

ERR_ESCROW_UNKNOWN = 'ESCROW_UNKNOWN'
ERR_ESCROW_EXISTS = 'ESCROW_EXISTS'
ERR_UNAUTHORIZED_SENDER = 'UNAUTHORIZED_SENDER'
ERR_COMMITMENT_MISMATCH = 'COMMITMENT_MISMATCH'
ERR_BAD_VALUE = 'BAD_VALUE'
ERR_BAD_AMOUNT = 'BAD_AMOUNT'
ERR_BAD_DEADLINE = 'BAD_DEADLINE'
ERR_BAD_VERDICT = 'BAD_VERDICT'
ERR_NOT_OWNER = 'NOT_OWNER'
ERR_GATE_ALREADY_SET = 'GATE_ALREADY_SET'
ERR_GATE_NOT_SET = 'GATE_NOT_SET'
ERR_NOT_FUNDER = 'NOT_FUNDER'
ERR_BAD_STATE = 'BAD_STATE'
ERR_DEADLINE_NOT_PASSED = 'DEADLINE_NOT_PASSED'
ERR_ACTION_MISMATCH = 'ACTION_MISMATCH'

FINALITY_SOURCE = 'protocol-delivery'
ZERO_ADDRESS_BYTES = b'\x00' * 20


def _now_unix() -> int:
	raw = str(gl.message.datetime)
	if raw.endswith('Z'):
		raw = raw[:-1] + '+00:00'
	moment = datetime.datetime.fromisoformat(raw)
	if moment.tzinfo is None:
		moment = moment.replace(tzinfo=datetime.timezone.utc)
	return int(moment.timestamp())


def _addr_hex(value) -> str:
	"""Lower-case hex for an address, from an ``Address`` or a hex string."""
	if isinstance(value, str):
		return value.strip().lower()
	return value.as_hex.lower()


def _keccak_hex(payload: str) -> str:
	hasher = Keccak256()
	hasher.update(payload.encode('utf-8'))
	return '0x' + hasher.digest().hex()


def compute_intent_hash(
	agent: str,
	recipient: str,
	amount: int,
	asset: str,
	policy_hash: str,
	evidence_digest: str,
	nonce: int,
	deadline_unix: int,
) -> str:
	"""The v1 commitment encoding, byte for byte. The vault recomputes it (I3)."""
	return _keccak_hex(
		'|'.join(
			(
				COMMITMENT_DOMAIN,
				'agent=' + agent,
				'recipient=' + recipient,
				'amount=' + str(amount),
				'asset=' + asset,
				'policy_hash=' + policy_hash,
				'evidence_digest=' + evidence_digest,
				'nonce=' + str(nonce),
				'deadline=' + str(deadline_unix),
			)
		)
	)


# Records are JSON strings in a TreeMap[str, str]. Typed storage classes need a
# decorator whose name differs between the linter's SDK and the runner the
# network executes, and the network rejects the linter's spelling
# (docs/evidence/milestone/spike/findings-session1.json). Plain strings need
# neither.


def _load(raw) -> dict:
	return json.loads(str(raw))


def _dump(record: dict) -> str:
	return json.dumps(record, sort_keys=True)


class FinalityVault(gl.contract.Contract):
	owner: Address
	gate: Address
	escrows: TreeMap[str, str]
	receipts: TreeMap[str, str]
	release_count: u256
	noop_count: u256

	def __init__(self, owner_address: Address):
		self.owner = Address(owner_address)
		self.gate = Address(ZERO_ADDRESS_BYTES)
		self.release_count = u256(0)
		self.noop_count = u256(0)

	# ------------------------------------------------------------------- views

	@gl.public.view
	def get_escrow(self, action_id: str) -> dict:
		if action_id not in self.escrows:
			return {
				'exists': False,
				'action_id': action_id,
				'state': '',
				'reason_code': ERR_ESCROW_UNKNOWN,
			}
		record = _load(self.escrows[action_id])
		return {
			'exists': True,
			'action_id': record['action_id'],
			'funder': record['funder'],
			'recipient': record['recipient'],
			'amount': int(record['amount']),
			'asset': record['asset'],
			'policy_hash': record['policy_hash'],
			'nonce': int(record['nonce']),
			'deadline_unix': int(record['deadline_unix']),
			'opened_at': record['opened_at'],
			'state': record['state'],
			'provisional': record['provisional'],
			'provisional_count': int(record['provisional_count']),
			'intent_hash': record['intent_hash'],
			'evidence_digest': record['evidence_digest'],
			'decision_id': record['decision_id'],
			'closed_at': record['closed_at'],
			'close_reason': record['close_reason'],
			'reason_code': '',
		}

	@gl.public.view
	def get_receipt(self, action_id: str) -> dict:
		if action_id not in self.receipts:
			return {
				'exists': False,
				'action_id': action_id,
				'reason_code': ERR_ESCROW_UNKNOWN,
			}
		record = _load(self.receipts[action_id])
		return {
			'exists': True,
			'action_id': record['action_id'],
			'decision_id': record['decision_id'],
			'intent_hash': record['intent_hash'],
			'policy_hash': record['policy_hash'],
			'evidence_digest': record['evidence_digest'],
			'nonce': int(record['nonce']),
			'amount': int(record['amount']),
			'asset': record['asset'],
			'funder': record['funder'],
			'recipient': record['recipient'],
			'opened_at': record['opened_at'],
			'settled_at': record['settled_at'],
			'finality_source': record['finality_source'],
			'delivered_by': record['delivered_by'],
			'status': record['status'],
			'message_stage': record['message_stage'],
		}

	@gl.public.view
	def describe(self) -> dict:
		return {
			'product': 'DEFINIT',
			'contract': 'FinalityVault',
			'version': 'v2',
			'owner': _addr_hex(self.owner),
			'gate': _addr_hex(self.gate),
			'release_count': int(self.release_count),
			'noop_count': int(self.noop_count),
			'finality_rule': 'protocol-finalized-delivery',
			'release_message_stage': 'finalized',
			'clock': 'return-to-funder-only',
		}

	# ------------------------------------------------------------------ writes

	@gl.public.write
	def set_gate(self, gate_address: str) -> dict:
		"""Bind the single authorized decision contract. Writable exactly once."""
		if gl.message.sender_address != self.owner:
			gl.vm.UserError.immediate(ERR_NOT_OWNER)
		if self.gate != Address(ZERO_ADDRESS_BYTES):
			gl.vm.UserError.immediate(ERR_GATE_ALREADY_SET)
		self.gate = Address(gate_address)
		return {'gate': _addr_hex(self.gate), 'state': 'BOUND'}

	@gl.public.write.payable
	def open_escrow(
		self,
		action_id: str,
		recipient: str,
		amount: int,
		asset: str,
		policy_hash: str,
		nonce: int,
		deadline_unix: int,
	) -> dict:
		"""Fund an escrow. The commitment fields come from the funder's own arguments.

		The gate is read once, to check that those fields equal the action the
		gate registered. That is a consistency check at funding time. It is not
		release authority: nothing read here is ever used to release value.
		"""
		if action_id in self.escrows:
			gl.vm.UserError.immediate(ERR_ESCROW_EXISTS)
		if self.gate == Address(ZERO_ADDRESS_BYTES):
			gl.vm.UserError.immediate(ERR_GATE_NOT_SET)
		if amount <= 0:
			gl.vm.UserError.immediate(ERR_BAD_AMOUNT)
		if int(gl.message.value) != amount:
			gl.vm.UserError.immediate(ERR_BAD_VALUE)
		if deadline_unix <= _now_unix():
			gl.vm.UserError.immediate(ERR_BAD_DEADLINE)

		action = gl.contract.get_at(self.gate).view().get_action(action_id)
		if not action['exists']:
			gl.vm.UserError.immediate(ERR_ACTION_MISMATCH)
		if _addr_hex(action['agent']) != _addr_hex(gl.message.sender_address):
			gl.vm.UserError.immediate(ERR_NOT_FUNDER)
		if _addr_hex(action['recipient']) != _addr_hex(recipient):
			gl.vm.UserError.immediate(ERR_ACTION_MISMATCH)
		if int(action['amount']) != amount:
			gl.vm.UserError.immediate(ERR_ACTION_MISMATCH)
		if str(action['asset']) != asset:
			gl.vm.UserError.immediate(ERR_ACTION_MISMATCH)
		if str(action['policy_hash']) != policy_hash:
			gl.vm.UserError.immediate(ERR_ACTION_MISMATCH)
		if int(action['nonce']) != nonce:
			gl.vm.UserError.immediate(ERR_ACTION_MISMATCH)
		if int(action['deadline_unix']) != deadline_unix:
			gl.vm.UserError.immediate(ERR_ACTION_MISMATCH)

		self.escrows[action_id] = _dump(
			{
				'action_id': action_id,
				'funder': _addr_hex(gl.message.sender_address),
				'recipient': _addr_hex(recipient),
				'amount': amount,
				'asset': asset,
				'policy_hash': policy_hash,
				'nonce': nonce,
				'deadline_unix': deadline_unix,
				'opened_at': str(gl.message.datetime),
				'state': STATE_OPEN,
				'provisional': MARK_NONE,
				'provisional_count': 0,
				'intent_hash': '',
				'evidence_digest': '',
				'decision_id': '',
				'closed_at': '',
				'close_reason': '',
			}
		)
		return {'action_id': action_id, 'amount': amount, 'state': STATE_OPEN}

	@gl.public.write
	def note_provisional(self, action_id: str, decision_id: str, verdict: str) -> dict:
		"""Record a provisional outcome as a display marker, and nothing else (I5).

		Gate-only, idempotent, and inert: it cannot change a balance or move an
		escrow out of OPEN. A repeated or contradictory notice, which the
		protocol can produce across appeal rounds, only rewrites the marker.
		"""
		if gl.message.sender_address != self.gate:
			gl.vm.UserError.immediate(ERR_UNAUTHORIZED_SENDER)
		if action_id not in self.escrows:
			gl.vm.UserError.immediate(ERR_ESCROW_UNKNOWN)
		if verdict != 'APPROVE' and verdict != 'REJECT':
			gl.vm.UserError.immediate(ERR_BAD_VERDICT)

		escrow = _load(self.escrows[action_id])
		if escrow['state'] != STATE_OPEN:
			self.noop_count = u256(int(self.noop_count) + 1)
			return {'action_id': action_id, 'status': 'NOOP', 'state': escrow['state']}

		escrow['provisional'] = MARK_PROVISIONAL_APPROVE if verdict == 'APPROVE' else MARK_PROVISIONAL_REJECT
		escrow['provisional_count'] = int(escrow['provisional_count']) + 1
		self.escrows[action_id] = _dump(escrow)
		return {'action_id': action_id, 'status': 'MARKED', 'state': escrow['state'], 'marker': escrow['provisional']}

	@gl.public.write
	def authorize_release(
		self,
		action_id: str,
		decision_id: str,
		intent_hash: str,
		evidence_digest: str,
		policy_hash: str,
		nonce: int,
		recipient: str,
		amount: int,
	) -> dict:
		"""Release escrow on a finalized delivery from the bound gate.

		Every guard is separate, so a failing test names the guard that stopped
		holding. Order matters: the sender is checked before anything else is
		read, and the effect is written before the transfer is emitted.
		"""
		# I1 -- only a message whose sender is the bound gate.
		if gl.message.sender_address != self.gate:
			gl.vm.UserError.immediate(ERR_UNAUTHORIZED_SENDER)
		if action_id not in self.escrows:
			gl.vm.UserError.immediate(ERR_ESCROW_UNKNOWN)

		escrow = _load(self.escrows[action_id])

		# I4, I11 -- a delivery that finds the escrow already closed is a
		# recorded no-op. It is never a second transfer and never an error that
		# could be mistaken for one.
		if escrow['state'] != STATE_OPEN:
			self.noop_count = u256(int(self.noop_count) + 1)
			return {'action_id': action_id, 'status': 'NOOP', 'state': escrow['state']}

		# I7 -- a release that arrives after the deadline does not release. This
		# comparison only ever denies: its sole effect is to route the escrow to
		# a refund for the funder.
		if _now_unix() > int(escrow['deadline_unix']):
			escrow['state'] = STATE_EXPIRED_REFUNDABLE
			escrow['closed_at'] = str(gl.message.datetime)
			escrow['close_reason'] = 'LATE_DELIVERY'
			self.escrows[action_id] = _dump(escrow)
			return {'action_id': action_id, 'status': 'EXPIRED', 'state': STATE_EXPIRED_REFUNDABLE}

		# I3 -- every delivered field must equal the escrow's own record.
		if _addr_hex(recipient) != str(escrow['recipient']):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if int(amount) != int(escrow['amount']):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if str(policy_hash) != str(escrow['policy_hash']):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)
		if int(nonce) != int(escrow['nonce']):
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)

		# I3 -- and the commitment is recomputed here from the escrow record plus
		# the delivered evidence digest. The delivered hash must equal it.
		recomputed = compute_intent_hash(
			str(escrow['funder']),
			str(escrow['recipient']),
			int(escrow['amount']),
			str(escrow['asset']),
			str(escrow['policy_hash']),
			str(evidence_digest),
			int(escrow['nonce']),
			int(escrow['deadline_unix']),
		)
		if str(intent_hash) != recomputed:
			gl.vm.UserError.immediate(ERR_COMMITMENT_MISMATCH)

		settled_at = str(gl.message.datetime)

		# Effect first. A replayed delivery then finds the escrow closed.
		escrow['state'] = STATE_SETTLED
		escrow['intent_hash'] = recomputed
		escrow['evidence_digest'] = str(evidence_digest)
		escrow['decision_id'] = decision_id
		escrow['closed_at'] = settled_at
		escrow['close_reason'] = 'RELEASED'
		self.escrows[action_id] = _dump(escrow)

		self.receipts[action_id] = _dump(
			{
				'action_id': action_id,
				'decision_id': decision_id,
				'intent_hash': recomputed,
				'policy_hash': str(escrow['policy_hash']),
				'evidence_digest': str(evidence_digest),
				'nonce': int(escrow['nonce']),
				'amount': int(escrow['amount']),
				'asset': str(escrow['asset']),
				'funder': str(escrow['funder']),
				'recipient': str(escrow['recipient']),
				'opened_at': str(escrow['opened_at']),
				'settled_at': settled_at,
				'finality_source': FINALITY_SOURCE,
				'delivered_by': _addr_hex(self.gate),
				'status': STATE_SETTLED,
				'message_stage': 'finalized',
			}
		)
		self.release_count = u256(int(self.release_count) + 1)

		gl.chain.Account(Address(str(escrow['recipient']))).emit_transfer(
			value=u256(int(escrow['amount'])), on='finalized'
		)

		return {
			'action_id': action_id,
			'status': STATE_SETTLED,
			'decision_id': decision_id,
			'amount': int(escrow['amount']),
			'recipient': str(escrow['recipient']),
			'finality_source': FINALITY_SOURCE,
		}

	@gl.public.write
	def close_refused(self, action_id: str, decision_id: str, reason_code: str) -> dict:
		"""A finalized refusal closes the escrow to the funder (I6). Gate-only."""
		if gl.message.sender_address != self.gate:
			gl.vm.UserError.immediate(ERR_UNAUTHORIZED_SENDER)
		if action_id not in self.escrows:
			gl.vm.UserError.immediate(ERR_ESCROW_UNKNOWN)

		escrow = _load(self.escrows[action_id])
		if escrow['state'] != STATE_OPEN:
			self.noop_count = u256(int(self.noop_count) + 1)
			return {'action_id': action_id, 'status': 'NOOP', 'state': escrow['state']}

		escrow['state'] = STATE_REFUNDABLE
		escrow['decision_id'] = decision_id
		escrow['closed_at'] = str(gl.message.datetime)
		escrow['close_reason'] = reason_code
		self.escrows[action_id] = _dump(escrow)
		return {'action_id': action_id, 'status': STATE_REFUNDABLE, 'reason_code': reason_code}

	@gl.public.write
	def withdraw_refund(self, action_id: str) -> dict:
		"""The funder takes back an escrow that a finalized refusal or a late delivery closed (I6)."""
		if action_id not in self.escrows:
			gl.vm.UserError.immediate(ERR_ESCROW_UNKNOWN)
		escrow = _load(self.escrows[action_id])
		if _addr_hex(gl.message.sender_address) != str(escrow['funder']):
			gl.vm.UserError.immediate(ERR_NOT_FUNDER)
		if escrow['state'] != STATE_REFUNDABLE and escrow['state'] != STATE_EXPIRED_REFUNDABLE:
			gl.vm.UserError.immediate(ERR_BAD_STATE)

		escrow['state'] = STATE_WITHDRAWN
		self.escrows[action_id] = _dump(escrow)
		gl.chain.Account(Address(str(escrow['funder']))).emit_transfer(
			value=u256(int(escrow['amount'])), on='finalized'
		)
		return {'action_id': action_id, 'status': STATE_WITHDRAWN, 'amount': int(escrow['amount'])}

	@gl.public.write
	def reclaim_after_deadline(self, action_id: str) -> dict:
		"""The funder reclaims an escrow that no finalized delivery ever closed (I9).

		This is the only place the vault authorizes anything from a clock, and it
		authorizes a return to the funder only. If a release delivery executes
		first, the escrow is no longer OPEN and this refuses; if this executes
		first, a later release delivery is a recorded no-op (I11).
		"""
		if action_id not in self.escrows:
			gl.vm.UserError.immediate(ERR_ESCROW_UNKNOWN)
		escrow = _load(self.escrows[action_id])
		if _addr_hex(gl.message.sender_address) != str(escrow['funder']):
			gl.vm.UserError.immediate(ERR_NOT_FUNDER)
		if escrow['state'] != STATE_OPEN:
			gl.vm.UserError.immediate(ERR_BAD_STATE)
		if _now_unix() <= int(escrow['deadline_unix']):
			gl.vm.UserError.immediate(ERR_DEADLINE_NOT_PASSED)

		escrow['state'] = STATE_RECLAIMED
		escrow['closed_at'] = str(gl.message.datetime)
		escrow['close_reason'] = 'RECLAIMED_AFTER_DEADLINE'
		self.escrows[action_id] = _dump(escrow)
		gl.chain.Account(Address(str(escrow['funder']))).emit_transfer(
			value=u256(int(escrow['amount'])), on='finalized'
		)
		return {'action_id': action_id, 'status': STATE_RECLAIMED, 'amount': int(escrow['amount'])}

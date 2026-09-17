# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""
DEFINIT -- control arm: provisional-stage release
================================================

This contract is NOT part of the product. It exists so that the claim
"finality gating prevents premature settlement" can be falsified rather than
asserted.

It is a deliberately naive counterpart to FinalityVault. It does the thing a
reasonable engineer writes when they read a transaction status and treat
"accepted" as "done":

  * it reads the decision contract *unscoped*, so a decision that is currently
    accepted but still appealable is visible to it;
  * it emits its outbound value on the accepted stage;
  * it has no nonce bookkeeping, so the same instruction can be delivered and
    executed more than once.

Running the same attack corpus against this contract and against
FinalityVault is the whole point of the proof campaign. Everything here is
intentionally wrong.
"""

import genlayer as gl
from genlayer import *  # noqa: F401,F403
from genlayer.storage import allow, Array, DynArray, TreeMap

from dataclasses import dataclass

STATE_OPEN = 'OPEN'
STATE_RELEASED = 'RELEASED'

ERR_ESCROW_UNKNOWN = 'ESCROW_UNKNOWN'
ERR_UNAUTHORIZED_CALLER = 'UNAUTHORIZED_CALLER'
ERR_VERDICT_NOT_APPROVE = 'VERDICT_NOT_APPROVE'
ERR_NOT_OWNER = 'NOT_OWNER'


@allow
@dataclass
class ProvisionalEscrow:
	action_id: str
	funder: Address
	recipient: Address
	amount: u256
	asset: str
	nonce: u256
	deadline_unix: u256
	opened_at: str
	state: str
	release_count: u256
	first_released_at: str


class UnsafeRelease(gl.contract.Contract):
	owner: Address
	gate: Address
	escrows: TreeMap[str, ProvisionalEscrow]
	releases: u256

	def __init__(self, owner_address: Address):
		self.owner = Address(owner_address)
		self.gate = Address(b'\x00' * 20)
		self.releases = u256(0)

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
			'funder': record.funder,
			'recipient': record.recipient,
			'amount': int(record.amount),
			'asset': record.asset,
			'nonce': int(record.nonce),
			'deadline_unix': int(record.deadline_unix),
			'opened_at': record.opened_at,
			'state': record.state,
			'release_count': int(record.release_count),
			'first_released_at': record.first_released_at,
		}

	@gl.public.view
	def describe(self) -> dict:
		return {
			'contract': 'UnsafeRelease',
			'role': 'control arm -- intentionally unsafe',
			'gate': self.gate,
			'releases': int(self.releases),
			'decision_read_scope': 'LATEST_DECIDED',
			'release_message_stage': 'accepted',
			'replay_protection': 'none',
		}

	@gl.public.write
	def set_gate(self, gate_address: str) -> dict:
		if gl.message.sender_address != self.owner:
			gl.vm.UserError.immediate(ERR_NOT_OWNER)
		self.gate = Address(gate_address)
		return {'gate': self.gate, 'state': 'BOUND'}

	@gl.public.write.payable
	def open_escrow(self, action_id: str) -> dict:
		action = gl.contract.get_at(self.gate).view().get_action(action_id)
		if not action['exists']:
			gl.vm.UserError.immediate(ERR_ESCROW_UNKNOWN)

		self.escrows[action_id] = ProvisionalEscrow(
			action_id=action_id,
			funder=gl.message.sender_address,
			recipient=action['recipient'],
			amount=u256(int(gl.message.value)),
			asset=str(action['asset']),
			nonce=u256(int(action['nonce'])),
			deadline_unix=u256(int(action['deadline_unix'])),
			opened_at=str(gl.message.datetime),
			state=STATE_OPEN,
			release_count=u256(0),
			first_released_at='',
		)
		return {
			'action_id': action_id,
			'amount': int(gl.message.value),
			'state': STATE_OPEN,
		}

	@gl.public.write
	def release_on_provisional(self, action_id: str, decision_id: str) -> dict:
		"""Release against any decision this contract can currently observe.

		The decision contract is read unscoped, so an accepted-but-appealable
		decision is fully visible. There is no nonce check and no
		already-released check, so a repeated instruction repeats the effect.
		"""
		if action_id not in self.escrows:
			gl.vm.UserError.immediate(ERR_ESCROW_UNKNOWN)
		if gl.message.sender_address != self.gate:
			gl.vm.UserError.immediate(ERR_UNAUTHORIZED_CALLER)

		escrow = self.escrows[action_id]

		decision = gl.contract.get_at(self.gate).view().get_decision(decision_id)
		if not decision['exists']:
			gl.vm.UserError.immediate(ERR_ESCROW_UNKNOWN)
		if str(decision['verdict']) != 'APPROVE':
			gl.vm.UserError.immediate(ERR_VERDICT_NOT_APPROVE)

		escrow.state = STATE_RELEASED
		if escrow.first_released_at == '':
			escrow.first_released_at = str(gl.message.datetime)
		escrow.release_count = u256(int(escrow.release_count) + 1)
		self.releases = u256(int(self.releases) + 1)

		gl.chain.Account(escrow.recipient).emit_transfer(
			value=escrow.amount, on='accepted'
		)

		return {
			'action_id': action_id,
			'decision_id': decision_id,
			'release_count': int(escrow.release_count),
			'decision_read_scope': 'LATEST_DECIDED',
			'message_stage': 'accepted',
		}

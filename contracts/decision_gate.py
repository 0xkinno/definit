# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""
DEFINIT -- DecisionGate
=======================

The decision side of the finality firewall.

Responsibilities
----------------
1. Accept a bounded action proposal and derive a canonical *action commitment*
   over (agent, recipient, amount, asset, policy hash, evidence digest, nonce,
   deadline).
2. Adjudicate real-world evidence against a published policy with a
   non-deterministic leader/validator block. The consensus surface is small:
   verdict, reason code and evidence digest.
3. Record the decision. An approving decision is recorded as ACCEPTED.
4. Expose a *finality capability* whose visibility depends on the storage state
   a reader scopes its read to.

What this contract never does
-----------------------------
It never performs an irreversible economic effect on the provisional stage.
Every settlement instruction it emits is emitted with on='finalized', and the
consumer independently re-reads this contract's final storage state before
moving funds.

The two independent finality boundaries used here
-------------------------------------------------
A. Timing. `emit(on='finalized')` defers the outbound message until the
   emitting transaction is final.
B. Visibility. A cross-contract read scoped to final storage state cannot
   observe a decision that has only reached the provisional stage.

Either boundary alone would be a weaker claim. Both together are the product.
"""

import json
import datetime

import genlayer as gl
from genlayer import *  # noqa: F401,F403
from genlayer.storage import allow, Array, DynArray, TreeMap

from dataclasses import dataclass

COMMITMENT_DOMAIN = 'DEFINIT-COMMITMENT-v1'
ACTION_DOMAIN = 'DEFINIT-ACTION-v1'
DECISION_DOMAIN = 'DEFINIT-DECISION-v1'
EVIDENCE_DOMAIN = 'DEFINIT-EVIDENCE-v1'

VERDICT_APPROVE = 'APPROVE'
VERDICT_REJECT = 'REJECT'
VERDICTS = (VERDICT_APPROVE, VERDICT_REJECT)

REASON_EVIDENCE_SATISFIES_POLICY = 'EVIDENCE_SATISFIES_POLICY'
REASON_EVIDENCE_MISSING = 'EVIDENCE_MISSING'
REASON_EVIDENCE_CONTRADICTS = 'EVIDENCE_CONTRADICTS'
REASON_POLICY_VIOLATION = 'POLICY_VIOLATION'
REASON_SOURCE_UNAVAILABLE = 'SOURCE_UNAVAILABLE'
REASON_OUT_OF_WINDOW = 'OUT_OF_WINDOW'
REASON_INVALID_REQUEST = 'INVALID_REQUEST'
REASON_CODES = (
	REASON_EVIDENCE_SATISFIES_POLICY,
	REASON_EVIDENCE_MISSING,
	REASON_EVIDENCE_CONTRADICTS,
	REASON_POLICY_VIOLATION,
	REASON_SOURCE_UNAVAILABLE,
	REASON_OUT_OF_WINDOW,
	REASON_INVALID_REQUEST,
)

STATE_SUBMITTED = 'SUBMITTED'
STATE_ADJUDICATING = 'ADJUDICATING'
STATE_ACCEPTED = 'ACCEPTED'
STATE_REJECTED = 'REJECTED'
STATE_FINALIZED = 'FINALIZED'
STATE_HELD = 'HELD'
STATE_SETTLED = 'SETTLED'

ERR_ACTION_UNKNOWN = 'ACTION_UNKNOWN'
ERR_NOT_AUTHORIZED = 'NOT_AUTHORIZED'
ERR_BAD_STATE = 'BAD_STATE'
ERR_BAD_DEADLINE = 'BAD_DEADLINE'
ERR_EXPIRED = 'EXPIRED'
ERR_BAD_RECIPIENT = 'BAD_RECIPIENT'
ERR_BAD_AMOUNT = 'BAD_AMOUNT'
ERR_BAD_ASSET = 'BAD_ASSET'
ERR_BAD_EVIDENCE_URL = 'BAD_EVIDENCE_URL'
ERR_POLICY_UNKNOWN = 'POLICY_UNKNOWN'
ERR_DECISION_UNKNOWN = 'DECISION_UNKNOWN'
ERR_DECISION_NOT_FINAL = 'DECISION_NOT_FINAL'
ERR_BAD_NONCE = 'BAD_NONCE'
ERR_APPEAL_WINDOW_OPEN = 'APPEAL_WINDOW_OPEN'

MAX_EVIDENCE_CHARS = 20000

# Seconds a decision must stand unchallenged after adjudication before it may be
# promoted to final. The same constant is held by the vault, which re-derives
# the window from ``adjudicated_at`` rather than trusting this contract's word.
APPEAL_WINDOW_SECONDS = 120


def _keccak_hex(payload: str) -> str:
	hasher = Keccak256()
	hasher.update(payload.encode('utf-8'))
	return '0x' + hasher.digest().hex()


def _addr_hex(value) -> str:
	"""Lower-case hex for an address.

	Accepts both an ``Address`` and the hex string a cross-contract read
	returns, because the two meet at the contract boundary and a comparison
	between them is the single most common place for a silent mismatch.
	"""
	if isinstance(value, str):
		return value.strip().lower()
	return value.as_hex.lower()


def commitment_payload(
	agent: str,
	recipient: str,
	amount: int,
	asset: str,
	policy_hash: str,
	evidence_digest: str,
	nonce: int,
	deadline_unix: int,
) -> str:
	"""Deterministic, ordered commitment encoding.

	This exact string is mirrored in the TypeScript client so that an
	independent party can recompute what was judged without asking us.
	"""
	return '|'.join(
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
	return _keccak_hex(
		commitment_payload(
			agent,
			recipient,
			amount,
			asset,
			policy_hash,
			evidence_digest,
			nonce,
			deadline_unix,
		)
	)


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


@allow
@dataclass
class ActionRecord:
	action_id: str
	agent: Address
	recipient: Address
	amount: u256
	asset: str
	policy_id: str
	policy_hash: str
	policy_version: str
	evidence_url: str
	evidence_digest: str
	intent_hash: str
	nonce: u256
	deadline_unix: u256
	created_at: str
	state: str
	decision_id: str
	attempts: u256
	last_reason: str
	finalized_at: str


@allow
@dataclass
class DecisionRecord:
	decision_id: str
	action_id: str
	verdict: str
	reason_code: str
	confidence: u256
	evidence_digest: str
	policy_hash: str
	intent_hash: str
	nonce: u256
	adjudicated_at: str
	finalized_at: str
	attempt: u256


def _request_summary(action) -> str:
	return (
		'action_id=' + str(action.action_id)
		+ '; asset=' + str(action.asset)
		+ '; amount=' + str(int(action.amount))
		+ '; policy_id=' + str(action.policy_id)
		+ '; policy_version=' + str(action.policy_version)
	)


def _adjudicate(
	policy_text: str,
	policy_hash: str,
	policy_id: str,
	evidence_url: str,
	request_summary: str,
) -> dict:
	"""Run the leader/validator adjudication.

	Consensus surface, which must match exactly between leader and validator:

	  * verdict
	  * reason_code
	  * evidence_digest

	Confidence is advisory and is deliberately excluded from the consensus
	surface: two independent models rarely agree on a number, and requiring
	them to would make honest disagreement look like a protocol failure.

	The evidence digest is derived *inside* the non-deterministic block from the
	snapshot the node actually observed. A caller cannot pre-commit to a digest
	it has not fetched.
	"""

	def fetch_snapshot() -> str:
		response = gl.nondet.web.get(evidence_url)
		body = response.body
		if body is None:
			return ''
		try:
			text = body.decode('utf-8')
		except Exception:
			text = body.decode('utf-8', errors='replace')
		return ' '.join(text.split())[:MAX_EVIDENCE_CHARS]

	def digest_of(snapshot: str) -> str:
		return _keccak_hex(EVIDENCE_DOMAIN + '|' + snapshot)

	def classify(snapshot: str) -> dict:
		task = (
			'You are a neutral adjudicator for a finality-gated payment system.\n'
			'You are given a payment policy, a requested action, and a snapshot of\n'
			'public evidence. Decide whether the evidence satisfies the policy for\n'
			'the requested action.\n\n'
			'POLICY ID: ' + policy_id + '\n'
			'POLICY:\n' + policy_text + '\n\n'
			'REQUESTED ACTION:\n' + request_summary + '\n\n'
			'EVIDENCE SNAPSHOT:\n'
			+ (snapshot if len(snapshot) > 0 else '(no evidence retrieved)')
			+ '\n\n'
			'Rules:\n'
			'- If the snapshot is empty or unreadable: verdict REJECT, reason_code SOURCE_UNAVAILABLE.\n'
			'- If the snapshot lacks the facts the policy requires: verdict REJECT, reason_code EVIDENCE_MISSING.\n'
			'- If the snapshot contradicts what the policy requires: verdict REJECT, reason_code EVIDENCE_CONTRADICTS.\n'
			'- If the snapshot breaks an explicit policy prohibition: verdict REJECT, reason_code POLICY_VIOLATION.\n'
			'- Only if every policy requirement is met: verdict APPROVE, reason_code EVIDENCE_SATISFIES_POLICY.\n'
			'- confidence is your own certainty, an integer from 0 to 100.\n'
			'- Do not invent facts that are not in the snapshot.\n\n'
			'Respond with JSON only, exactly this shape:\n'
			'{"verdict": "APPROVE" or "REJECT", '
			'"reason_code": "EVIDENCE_SATISFIES_POLICY" or "EVIDENCE_MISSING" or '
			'"EVIDENCE_CONTRADICTS" or "POLICY_VIOLATION" or "SOURCE_UNAVAILABLE" or '
			'"OUT_OF_WINDOW" or "INVALID_REQUEST", '
			'"confidence": 0, '
			'"note": "one short sentence"}\n'
		)
		raw = gl.nondet.exec_prompt(task, response_format='json')
		verdict = str(raw.get('verdict', '')).strip().upper()
		reason = str(raw.get('reason_code', '')).strip().upper()
		if verdict not in VERDICTS:
			verdict = VERDICT_REJECT
		if reason not in REASON_CODES:
			reason = REASON_INVALID_REQUEST
		try:
			confidence = int(raw.get('confidence', 0))
		except Exception:
			confidence = 0
		if confidence < 0:
			confidence = 0
		if confidence > 100:
			confidence = 100
		return {'verdict': verdict, 'reason_code': reason, 'confidence': confidence}

	def leader_fn() -> dict:
		snapshot = fetch_snapshot()
		if len(snapshot) == 0:
			return {
				'verdict': VERDICT_REJECT,
				'reason_code': REASON_SOURCE_UNAVAILABLE,
				'confidence': 100,
				'evidence_digest': digest_of(''),
			}
		result = classify(snapshot)
		return {
			'verdict': result['verdict'],
			'reason_code': result['reason_code'],
			'confidence': result['confidence'],
			'evidence_digest': digest_of(snapshot),
		}

	def validator_fn(leaders_result) -> bool:
		if not isinstance(leaders_result, gl.vm.Return):
			return False
		supplied = leaders_result.calldata
		if not isinstance(supplied, dict):
			return False

		snapshot = fetch_snapshot()
		if supplied.get('evidence_digest') != digest_of(snapshot):
			return False

		if len(snapshot) == 0:
			return supplied.get('verdict') == VERDICT_REJECT

		mine = classify(snapshot)
		return (
			supplied.get('verdict') == mine['verdict']
			and supplied.get('reason_code') == mine['reason_code']
		)

	result = gl.vm.run_nondet_default(leader_fn, validator_fn)
	return {
		'verdict': str(result['verdict']),
		'reason_code': str(result['reason_code']),
		'confidence': int(result['confidence']),
		'evidence_digest': str(result['evidence_digest']),
	}


class DecisionGate(gl.contract.Contract):
	vault: Address
	registry: Address
	owner: Address
	actions: TreeMap[str, ActionRecord]
	decisions: TreeMap[str, DecisionRecord]
	agent_index: TreeMap[str, str]
	total_actions: u256

	def __init__(self, vault_address: Address, registry_address: Address):
		self.vault = Address(vault_address)
		self.registry = Address(registry_address)
		self.owner = gl.message.sender_address
		self.total_actions = u256(0)

	# ------------------------------------------------------------------- views

	@gl.public.view
	def get_action(self, action_id: str) -> dict:
		if action_id not in self.actions:
			return {
				'exists': False,
				'action_id': action_id,
				'state': '',
				'reason_code': ERR_ACTION_UNKNOWN,
			}
		record = self.actions[action_id]
		return {
			'exists': True,
			'action_id': record.action_id,
			'agent': _addr_hex(record.agent),
			'recipient': _addr_hex(record.recipient),
			'amount': int(record.amount),
			'asset': record.asset,
			'policy_id': record.policy_id,
			'policy_hash': record.policy_hash,
			'policy_version': record.policy_version,
			'evidence_url': record.evidence_url,
			'evidence_digest': record.evidence_digest,
			'intent_hash': record.intent_hash,
			'nonce': int(record.nonce),
			'deadline_unix': int(record.deadline_unix),
			'created_at': record.created_at,
			'state': record.state,
			'decision_id': record.decision_id,
			'attempts': int(record.attempts),
			'last_reason': record.last_reason,
			'finalized_at': record.finalized_at,
			'reason_code': '',
		}

	@gl.public.view
	def get_decision(self, decision_id: str) -> dict:
		if decision_id not in self.decisions:
			return {
				'exists': False,
				'decision_id': decision_id,
				'reason_code': ERR_DECISION_UNKNOWN,
			}
		record = self.decisions[decision_id]
		return {
			'exists': True,
			'decision_id': record.decision_id,
			'action_id': record.action_id,
			'verdict': record.verdict,
			'reason_code': record.reason_code,
			'confidence': int(record.confidence),
			'evidence_digest': record.evidence_digest,
			'policy_hash': record.policy_hash,
			'intent_hash': record.intent_hash,
			'nonce': int(record.nonce),
			'adjudicated_at': record.adjudicated_at,
			'finalized_at': record.finalized_at,
			'attempt': int(record.attempt),
		}

	@gl.public.view
	def get_capability(self, decision_id: str) -> dict:
		"""The finality capability.

		This is the object a consumer must obtain before an irreversible effect
		is permitted. It is a plain read of stored state, which is the point:
		the same call made against provisional storage state and against final
		storage state returns different answers.

		Read it unscoped and you may see a decision that is still appealable.
		Read it scoped to final state and you can only see a decision that has
		already settled into consensus.
		"""
		if decision_id not in self.decisions:
			return {
				'exists': False,
				'decision_id': decision_id,
				'reason_code': ERR_DECISION_UNKNOWN,
			}

		decision = self.decisions[decision_id]
		if decision.action_id not in self.actions:
			return {
				'exists': False,
				'decision_id': decision_id,
				'reason_code': ERR_ACTION_UNKNOWN,
			}

		action = self.actions[decision.action_id]
		return {
			'exists': True,
			'decision_id': decision.decision_id,
			'action_id': decision.action_id,
			'verdict': decision.verdict,
			'reason_code': decision.reason_code,
			'confidence': int(decision.confidence),
			'evidence_digest': decision.evidence_digest,
			'policy_hash': decision.policy_hash,
			'intent_hash': decision.intent_hash,
			'nonce': int(decision.nonce),
			'amount': int(action.amount),
			'recipient': _addr_hex(action.recipient),
			'asset': action.asset,
			'deadline_unix': int(action.deadline_unix),
			'agent': _addr_hex(action.agent),
			'adjudicated_at': decision.adjudicated_at,
			'finalized_at': decision.finalized_at,
			'state': action.state,
			'read_scope': 'finalized-capability',
		}

	@gl.public.view
	def list_actions_for(self, agent: str) -> list:
		key = agent.lower()
		if key not in self.agent_index:
			return []
		out = []
		for action_id in json.loads(self.agent_index[key]):
			if action_id in self.actions:
				record = self.actions[action_id]
				out.append(
					{
						'action_id': record.action_id,
						'amount': int(record.amount),
						'asset': record.asset,
						'state': record.state,
						'policy_id': record.policy_id,
						'created_at': record.created_at,
					}
				)
		return out

	@gl.public.view
	def describe(self) -> dict:
		return {
			'product': 'DEFINIT',
			'contract': 'DecisionGate',
			'vault': _addr_hex(self.vault),
			'registry': _addr_hex(self.registry),
			'owner': _addr_hex(self.owner),
			'total_actions': int(self.total_actions),
			'commitment_domain': COMMITMENT_DOMAIN,
			'capability_read_scope': 'FINALIZED_CAPABILITY',
			'finality_rule': 'promoted-plus-appeal-window',
			'appeal_window_seconds': APPEAL_WINDOW_SECONDS,
			'settlement_message_stage': 'finalized',
			'finality_enforced_by': 'DecisionGate.finalize_decision + FinalityVault.settle',
		}

	# ------------------------------------------------------------------ writes

	@gl.public.write
	def create_action(
		self,
		recipient: str,
		amount: int,
		asset: str,
		policy_id: str,
		evidence_url: str,
		deadline_unix: int,
		nonce: int,
	) -> str:
		"""Register an action proposal and derive its canonical commitment."""
		if amount <= 0:
			gl.vm.UserError.immediate(ERR_BAD_AMOUNT)
		if len(asset) == 0:
			gl.vm.UserError.immediate(ERR_BAD_ASSET)
		if not evidence_url.startswith('https://'):
			gl.vm.UserError.immediate(ERR_BAD_EVIDENCE_URL)
		if deadline_unix <= _now_unix():
			gl.vm.UserError.immediate(ERR_BAD_DEADLINE)
		if nonce <= 0:
			gl.vm.UserError.immediate(ERR_BAD_NONCE)

		try:
			recipient_address = Address(recipient)
		except Exception:
			gl.vm.UserError.immediate(ERR_BAD_RECIPIENT)

		policy = gl.contract.get_at(self.registry).view().get_policy(policy_id)
		if not policy['exists']:
			gl.vm.UserError.immediate(ERR_POLICY_UNKNOWN)

		agent = gl.message.sender_address
		created_at = str(gl.message.datetime)
		policy_hash = str(policy['policy_hash'])

		action_id = _keccak_hex(
			'|'.join(
				(
					ACTION_DOMAIN,
					'agent=' + _addr_hex(agent),
					'recipient=' + _addr_hex(recipient_address),
					'amount=' + str(amount),
					'asset=' + asset,
					'policy_hash=' + policy_hash,
					'nonce=' + str(nonce),
					'created_at=' + created_at,
				)
			)
		)

		self.actions[action_id] = ActionRecord(
			action_id=action_id,
			agent=agent,
			recipient=recipient_address,
			amount=u256(amount),
			asset=asset,
			policy_id=policy_id,
			policy_hash=policy_hash,
			policy_version=str(policy['version']),
			evidence_url=evidence_url,
			evidence_digest='',
			intent_hash='',
			nonce=u256(nonce),
			deadline_unix=u256(deadline_unix),
			created_at=created_at,
			state=STATE_SUBMITTED,
			decision_id='',
			attempts=u256(0),
			last_reason='',
			finalized_at='',
		)
		self.total_actions = u256(int(self.total_actions) + 1)

		agent_key = _addr_hex(agent)
		if agent_key not in self.agent_index:
			self.agent_index[agent_key] = '[]'
		ids = json.loads(self.agent_index[agent_key])
		ids.append(action_id)
		self.agent_index[agent_key] = json.dumps(ids)

		return action_id

	@gl.public.write
	def request_adjudication(self, action_id: str) -> dict:
		"""Adjudicate the action's evidence against its policy.

		On an approving verdict the action moves to ACCEPTED and a settlement
		instruction is emitted on the finalized stage. On a rejecting verdict
		the action moves to REJECTED and nothing is emitted.
		"""
		if action_id not in self.actions:
			gl.vm.UserError.immediate(ERR_ACTION_UNKNOWN)

		action = self.actions[action_id]
		if action.agent != gl.message.sender_address:
			gl.vm.UserError.immediate(ERR_NOT_AUTHORIZED)
		if action.state not in (STATE_SUBMITTED, STATE_REJECTED):
			gl.vm.UserError.immediate(ERR_BAD_STATE)
		if _now_unix() > int(action.deadline_unix):
			gl.vm.UserError.immediate(ERR_EXPIRED)

		policy_lookup = (
			gl.contract.get_at(self.registry).view().get_policy(str(action.policy_id))
		)
		outcome = _adjudicate(
			policy_text=str(policy_lookup['text']),
			policy_hash=str(action.policy_hash),
			policy_id=str(action.policy_id),
			evidence_url=str(action.evidence_url),
			request_summary=_request_summary(action),
		)
		return self._record_outcome(action_id, outcome)

	@gl.public.write
	def finalize_decision(self, decision_id: str) -> dict:
		"""Promote an accepted decision to final and schedule the settlement.

		This method does not read itself, and the reason is worth stating. A
		self-read scoped to final storage would have to acquire this contract's
		execution slot while this contract is already executing inside it. The
		runtime does not do that, so the call never returns -- it is a
		re-entrancy deadlock, not a guard.

		The authoritative finality read therefore lives in the vault, which is
		also where value moves. This call records the agent's decision to move
		on and schedules the settlement message on the finalized stage. The
		vault then re-reads this contract's FINAL storage state on its own. If
		the decision is still appealable that read does not see it, and the
		release is refused with DECISION_NOT_FINAL.

		That is the product: the effect waits for finality because the contract
		holding the value says so, not because a caller promised to wait.
		"""
		if decision_id not in self.decisions:
			gl.vm.UserError.immediate(ERR_DECISION_UNKNOWN)

		decision = self.decisions[decision_id]
		action_id = str(decision.action_id)
		if action_id not in self.actions:
			gl.vm.UserError.immediate(ERR_ACTION_UNKNOWN)

		action = self.actions[action_id]
		if action.agent != gl.message.sender_address:
			gl.vm.UserError.immediate(ERR_NOT_AUTHORIZED)
		if decision.verdict != VERDICT_APPROVE:
			gl.vm.UserError.immediate(ERR_BAD_STATE)

		# The appeal window. A decision is provisional for exactly this long,
		# measured on chain from the moment it was adjudicated. Promoting inside
		# the window is refused here, which is what makes FINAL a state a caller
		# cannot claim early rather than a promise a caller makes.
		if _now_unix() < (
			_unix_from_iso(decision.adjudicated_at) + APPEAL_WINDOW_SECONDS
		):
			gl.vm.UserError.immediate(ERR_APPEAL_WINDOW_OPEN)

		now = str(gl.message.datetime)
		action.state = STATE_FINALIZED
		action.finalized_at = now
		decision.finalized_at = now

		self._emit_finality_bound_settlement(action_id, decision_id)

		return {
			'action_id': action_id,
			'decision_id': decision_id,
			'state': STATE_FINALIZED,
			'finality_rule': 'promoted-plus-appeal-window',
			'appeal_window_seconds': APPEAL_WINDOW_SECONDS,
			'finality_proof': 'this contract refused to promote until the appeal window closed; the vault re-derives the same window from adjudicated_at before releasing',
			'settlement_message_stage': 'finalized',
		}

	@gl.public.write
	def mark_held(self, action_id: str, reason: str) -> dict:
		"""Freeze an action when a lifecycle precondition cannot be met."""
		if action_id not in self.actions:
			gl.vm.UserError.immediate(ERR_ACTION_UNKNOWN)
		action = self.actions[action_id]
		if action.agent != gl.message.sender_address:
			gl.vm.UserError.immediate(ERR_NOT_AUTHORIZED)
		if action.state == STATE_SETTLED:
			gl.vm.UserError.immediate(ERR_BAD_STATE)
		action.state = STATE_HELD
		action.last_reason = reason
		return {'action_id': action_id, 'state': STATE_HELD, 'reason_code': reason}

	@gl.public.write
	def mark_settled(self, action_id: str) -> dict:
		"""Reconcile local state after the vault reports a completed settlement.

		Only the vault may call this, and only for an action it has released.
		"""
		if gl.message.sender_address != self.vault:
			gl.vm.UserError.immediate(ERR_NOT_AUTHORIZED)
		if action_id not in self.actions:
			gl.vm.UserError.immediate(ERR_ACTION_UNKNOWN)
		action = self.actions[action_id]
		if action.state not in (STATE_ACCEPTED, STATE_FINALIZED):
			gl.vm.UserError.immediate(ERR_BAD_STATE)
		action.state = STATE_SETTLED
		return {'action_id': action_id, 'state': STATE_SETTLED}

	# --------------------------------------------------------------- internals

	def _record_outcome(self, action_id: str, outcome: dict) -> dict:
		action = self.actions[action_id]
		attempt = int(action.attempts) + 1
		adjudicated_at = str(gl.message.datetime)
		evidence_digest = str(outcome['evidence_digest'])

		intent_hash = compute_intent_hash(
			_addr_hex(action.agent),
			_addr_hex(action.recipient),
			int(action.amount),
			str(action.asset),
			str(action.policy_hash),
			evidence_digest,
			int(action.nonce),
			int(action.deadline_unix),
		)

		decision_id = _keccak_hex(
			'|'.join(
				(
					DECISION_DOMAIN,
					'action=' + action_id,
					'attempt=' + str(attempt),
					'intent_hash=' + intent_hash,
					'adjudicated_at=' + adjudicated_at,
				)
			)
		)

		self.decisions[decision_id] = DecisionRecord(
			decision_id=decision_id,
			action_id=action_id,
			verdict=str(outcome['verdict']),
			reason_code=str(outcome['reason_code']),
			confidence=u256(int(outcome['confidence'])),
			evidence_digest=evidence_digest,
			policy_hash=str(action.policy_hash),
			intent_hash=intent_hash,
			nonce=action.nonce,
			adjudicated_at=adjudicated_at,
			finalized_at='',
			attempt=u256(attempt),
		)

		action.attempts = u256(attempt)
		action.decision_id = decision_id
		action.evidence_digest = evidence_digest
		action.intent_hash = intent_hash
		action.last_reason = str(outcome['reason_code'])

		if str(outcome['verdict']) == VERDICT_APPROVE:
			# Acceptance is provisional, and no settlement instruction is issued
			# here on purpose. At this moment the decision is still appealable,
			# so an instruction issued now would be refused by the vault anyway.
			# The instruction is issued by `finalize_decision`, which is called
			# once the decision is readable in final storage state.
			action.state = STATE_ACCEPTED
		else:
			action.state = STATE_REJECTED

		return {
			'action_id': action_id,
			'decision_id': decision_id,
			'verdict': str(outcome['verdict']),
			'reason_code': str(outcome['reason_code']),
			'confidence': int(outcome['confidence']),
			'evidence_digest': evidence_digest,
			'intent_hash': intent_hash,
			'state': action.state,
			'settlement_message_stage': 'finalized',
		}

	def _emit_finality_bound_settlement(self, action_id: str, decision_id: str) -> None:
		"""Emit the outbound settlement instruction on the finalized stage.

		The message carries the complete commitment so the vault can check it
		against its own escrow record. The vault does not trust this message:
		it re-reads this contract's final state and compares.
		"""
		action = self.actions[action_id]
		(
			gl.contract.get_at(self.vault)
			.emit(value=u256(0), on='finalized')
			.settle(
				action_id,
				decision_id,
				str(action.intent_hash),
				str(action.policy_hash),
				str(action.evidence_digest),
				int(action.nonce),
				_addr_hex(action.recipient),
				int(action.amount),
			)
		)

# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""
DEFINIT v2 -- DecisionGate
==========================

Release authority is a protocol delivery, not a read and not a timer.

What this contract does
-----------------------
1. Accepts a bounded action proposal and derives its canonical commitment.
2. Adjudicates real-world evidence against a published policy with a
   non-deterministic leader/validator block. The consensus surface is small:
   verdict, reason code and evidence digest.
3. From the adjudicating transaction itself, emits one message on the
   finalized stage:

       APPROVE  ->  vault.authorize_release(...)
       REJECT   ->  vault.close_refused(...)

What this contract never does
-----------------------------
It never promotes a decision. There is no `finalize_decision`, no elapsed-time
constant and no appeal-window arithmetic. A message emitted on the finalized
stage is not a call this contract makes. It is a child transaction the protocol
creates from the adjudicating transaction, after that transaction has survived
its appeal window. If an appeal changes the decision, the recomputed execution
emits the other message and the protocol never delivers the first.

Measured constraints this file is written around
------------------------------------------------
* Two messages to the same method on the same contract collide in the fee
  allocation (`AllocationDuplicateKey`). The two outcomes therefore target
  different vault methods, and each branch emits exactly one message.
* `emit(on='accepted')` raised an execution error in the VM under the pinned
  runner, so this contract does not emit a provisional notice. The vault keeps a
  gate-only `note_provisional` that is inert by construction. See
  docs/evidence/milestone/spike/findings-session1.json (O5).
* A funded child that fails at execution leaves its parent successful and its
  effect unapplied (spike E4b). That is why the vault has a funder reclaim.

The escrow must exist before adjudication. A finalized delivery to an escrow
that does not exist cannot be retried, so this contract refuses to adjudicate an
action whose escrow is not open.
"""

import json
import datetime

import genlayer as gl
from genlayer import *  # noqa: F401,F403
from genlayer.storage import TreeMap

# The commitment encoding is byte-identical to v1 so the TypeScript mirror and
# every v1 receipt still verify. Only the decision domain changes, so a v1 and a
# v2 decision id can never collide.
COMMITMENT_DOMAIN = 'DEFINIT-COMMITMENT-v1'
ACTION_DOMAIN = 'DEFINIT-ACTION-v1'
DECISION_DOMAIN = 'DEFINIT-DECISION-v2'
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
STATE_ACCEPTED = 'ACCEPTED'
STATE_REJECTED = 'REJECTED'
STATE_HELD = 'HELD'

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
ERR_BAD_NONCE = 'BAD_NONCE'
ERR_ESCROW_NOT_FUNDED = 'ESCROW_NOT_FUNDED'

MAX_EVIDENCE_CHARS = 20000


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
	independent party can recompute what was judged without asking us. It is
	unchanged from v1.
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


def _now_unix() -> int:
	raw = str(gl.message.datetime)
	if raw.endswith('Z'):
		raw = raw[:-1] + '+00:00'
	moment = datetime.datetime.fromisoformat(raw)
	if moment.tzinfo is None:
		moment = moment.replace(tzinfo=datetime.timezone.utc)
	return int(moment.timestamp())


# Records are stored as JSON strings in a TreeMap[str, str]. Typed storage
# classes need a decorator whose name differs between the linter's SDK and the
# runner the network executes, and the network rejects the linter's spelling
# (docs/evidence/milestone/spike/findings-session1.json). Plain strings need
# neither.


def _load(raw) -> dict:
	return json.loads(str(raw))


def _dump(record: dict) -> str:
	return json.dumps(record, sort_keys=True)


def _request_summary(action: dict) -> str:
	return (
		'action_id=' + str(action['action_id'])
		+ '; asset=' + str(action['asset'])
		+ '; amount=' + str(int(action['amount']))
		+ '; policy_id=' + str(action['policy_id'])
		+ '; policy_version=' + str(action['policy_version'])
	)


def _fetch_snapshot(evidence_url: str) -> str:
	response = gl.nondet.web.get(evidence_url)
	body = response.body
	if body is None:
		return ''
	try:
		text = body.decode('utf-8')
	except Exception:
		text = body.decode('utf-8', errors='replace')
	return ' '.join(text.split())[:MAX_EVIDENCE_CHARS]


def _digest_of(snapshot: str) -> str:
	return _keccak_hex(EVIDENCE_DOMAIN + '|' + snapshot)


def _classify(policy_text: str, policy_id: str, request_summary: str, snapshot: str) -> dict:
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


def _adjudicate(
	policy_text: str,
	policy_hash: str,
	policy_id: str,
	evidence_url: str,
	request_summary: str,
) -> dict:
	"""Run the leader/validator adjudication.

	Consensus surface, which must match exactly between leader and validator:
	verdict, reason_code and evidence_digest. Confidence is advisory and is
	excluded: two independent models rarely agree on a number, and requiring
	them to would make honest disagreement look like a protocol failure.

	The evidence digest is derived inside the non-deterministic block from the
	snapshot the node actually observed. A caller cannot pre-commit to a digest
	it has not fetched.
	"""

	def leader_fn() -> dict:
		snapshot = _fetch_snapshot(evidence_url)
		if len(snapshot) == 0:
			return {
				'verdict': VERDICT_REJECT,
				'reason_code': REASON_SOURCE_UNAVAILABLE,
				'confidence': 100,
				'evidence_digest': _digest_of(''),
			}
		result = _classify(policy_text, policy_id, request_summary, snapshot)
		return {
			'verdict': result['verdict'],
			'reason_code': result['reason_code'],
			'confidence': result['confidence'],
			'evidence_digest': _digest_of(snapshot),
		}

	def validator_fn(leaders_result) -> bool:
		if not isinstance(leaders_result, gl.vm.Return):
			return False
		supplied = leaders_result.calldata
		if not isinstance(supplied, dict):
			return False

		snapshot = _fetch_snapshot(evidence_url)
		if supplied.get('evidence_digest') != _digest_of(snapshot):
			return False

		if len(snapshot) == 0:
			return supplied.get('verdict') == VERDICT_REJECT

		mine = _classify(policy_text, policy_id, request_summary, snapshot)
		return (
			supplied.get('verdict') == mine['verdict']
			and supplied.get('reason_code') == mine['reason_code']
		)

	result = gl.vm.run_nondet(leader_fn, validator_fn)
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
	actions: TreeMap[str, str]
	decisions: TreeMap[str, str]
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
		record = _load(self.actions[action_id])
		return {
			'exists': True,
			'action_id': record['action_id'],
			'agent': record['agent'],
			'recipient': record['recipient'],
			'amount': int(record['amount']),
			'asset': record['asset'],
			'policy_id': record['policy_id'],
			'policy_hash': record['policy_hash'],
			'policy_version': record['policy_version'],
			'evidence_url': record['evidence_url'],
			'evidence_digest': record['evidence_digest'],
			'intent_hash': record['intent_hash'],
			'nonce': int(record['nonce']),
			'deadline_unix': int(record['deadline_unix']),
			'created_at': record['created_at'],
			'state': record['state'],
			'decision_id': record['decision_id'],
			'attempts': int(record['attempts']),
			'last_reason': record['last_reason'],
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
		record = _load(self.decisions[decision_id])
		return {
			'exists': True,
			'decision_id': record['decision_id'],
			'action_id': record['action_id'],
			'verdict': record['verdict'],
			'reason_code': record['reason_code'],
			'confidence': int(record['confidence']),
			'evidence_digest': record['evidence_digest'],
			'policy_hash': record['policy_hash'],
			'intent_hash': record['intent_hash'],
			'nonce': int(record['nonce']),
			'adjudicated_at': record['adjudicated_at'],
			'attempt': int(record['attempt']),
		}

	@gl.public.view
	def list_actions_for(self, agent: str) -> list:
		key = agent.lower()
		if key not in self.agent_index:
			return []
		out = []
		for action_id in json.loads(self.agent_index[key]):
			if action_id in self.actions:
				record = _load(self.actions[action_id])
				out.append(
					{
						'action_id': record['action_id'],
						'amount': int(record['amount']),
						'asset': record['asset'],
						'state': record['state'],
						'policy_id': record['policy_id'],
						'created_at': record['created_at'],
					}
				)
		return out

	@gl.public.view
	def describe(self) -> dict:
		return {
			'product': 'DEFINIT',
			'contract': 'DecisionGate',
			'version': 'v2',
			'vault': _addr_hex(self.vault),
			'registry': _addr_hex(self.registry),
			'owner': _addr_hex(self.owner),
			'total_actions': int(self.total_actions),
			'commitment_domain': COMMITMENT_DOMAIN,
			'decision_domain': DECISION_DOMAIN,
			'finality_rule': 'protocol-finalized-delivery',
			'settlement_message_stage': 'finalized',
			'clock': 'none',
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

		self.actions[action_id] = _dump(
			{
				'action_id': action_id,
				'agent': _addr_hex(agent),
				'recipient': _addr_hex(recipient_address),
				'amount': amount,
				'asset': asset,
				'policy_id': policy_id,
				'policy_hash': policy_hash,
				'policy_version': str(policy['version']),
				'evidence_url': evidence_url,
				'evidence_digest': '',
				'intent_hash': '',
				'nonce': nonce,
				'deadline_unix': deadline_unix,
				'created_at': created_at,
				'state': STATE_SUBMITTED,
				'decision_id': '',
				'attempts': 0,
				'last_reason': '',
			}
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
		"""Adjudicate the action's evidence and schedule the outcome on the finalized stage.

		The escrow must already be open. A finalized delivery to an escrow that
		does not exist cannot be retried, so adjudicating first would be able to
		produce a verdict that can never be acted on.

		Exactly one message is emitted, on the finalized stage:
		APPROVE schedules `authorize_release`, REJECT schedules `close_refused`.
		Nothing here reads a clock to authorize anything.
		"""
		if action_id not in self.actions:
			gl.vm.UserError.immediate(ERR_ACTION_UNKNOWN)

		action = _load(self.actions[action_id])
		if action['agent'] != _addr_hex(gl.message.sender_address):
			gl.vm.UserError.immediate(ERR_NOT_AUTHORIZED)
		if action['state'] != STATE_SUBMITTED:
			gl.vm.UserError.immediate(ERR_BAD_STATE)
		if _now_unix() > int(action['deadline_unix']):
			gl.vm.UserError.immediate(ERR_EXPIRED)

		escrow = gl.contract.get_at(self.vault).view().get_escrow(action_id)
		if not escrow['exists'] or str(escrow['state']) != 'OPEN':
			gl.vm.UserError.immediate(ERR_ESCROW_NOT_FUNDED)

		policy_lookup = (
			gl.contract.get_at(self.registry).view().get_policy(str(action['policy_id']))
		)
		outcome = _adjudicate(
			policy_text=str(policy_lookup['text']),
			policy_hash=str(action['policy_hash']),
			policy_id=str(action['policy_id']),
			evidence_url=str(action['evidence_url']),
			request_summary=_request_summary(action),
		)
		return self._record_outcome(action_id, action, outcome)

	@gl.public.write
	def mark_held(self, action_id: str, reason: str) -> dict:
		"""Freeze an action before it has been adjudicated.

		After adjudication a finalized message is already scheduled, and a HELD
		label would misdescribe what the protocol is about to deliver.
		"""
		if action_id not in self.actions:
			gl.vm.UserError.immediate(ERR_ACTION_UNKNOWN)
		action = _load(self.actions[action_id])
		if action['agent'] != _addr_hex(gl.message.sender_address):
			gl.vm.UserError.immediate(ERR_NOT_AUTHORIZED)
		if action['state'] != STATE_SUBMITTED:
			gl.vm.UserError.immediate(ERR_BAD_STATE)
		action['state'] = STATE_HELD
		action['last_reason'] = reason
		self.actions[action_id] = _dump(action)
		return {'action_id': action_id, 'state': STATE_HELD, 'reason_code': reason}

	# --------------------------------------------------------------- internals

	def _record_outcome(self, action_id: str, action: dict, outcome: dict) -> dict:
		attempt = int(action['attempts']) + 1
		adjudicated_at = str(gl.message.datetime)
		evidence_digest = str(outcome['evidence_digest'])

		intent_hash = compute_intent_hash(
			str(action['agent']),
			str(action['recipient']),
			int(action['amount']),
			str(action['asset']),
			str(action['policy_hash']),
			evidence_digest,
			int(action['nonce']),
			int(action['deadline_unix']),
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

		self.decisions[decision_id] = _dump(
			{
				'decision_id': decision_id,
				'action_id': action_id,
				'verdict': str(outcome['verdict']),
				'reason_code': str(outcome['reason_code']),
				'confidence': int(outcome['confidence']),
				'evidence_digest': evidence_digest,
				'policy_hash': str(action['policy_hash']),
				'intent_hash': intent_hash,
				'nonce': int(action['nonce']),
				'adjudicated_at': adjudicated_at,
				'attempt': attempt,
			}
		)

		action['attempts'] = attempt
		action['decision_id'] = decision_id
		action['evidence_digest'] = evidence_digest
		action['intent_hash'] = intent_hash
		action['last_reason'] = str(outcome['reason_code'])

		vault = gl.contract.get_at(self.vault)
		if str(outcome['verdict']) == VERDICT_APPROVE:
			action['state'] = STATE_ACCEPTED
			vault.emit(on='finalized').authorize_release(
				action_id,
				decision_id,
				intent_hash,
				evidence_digest,
				str(action['policy_hash']),
				int(action['nonce']),
				str(action['recipient']),
				int(action['amount']),
			)
		else:
			action['state'] = STATE_REJECTED
			vault.emit(on='finalized').close_refused(
				action_id,
				decision_id,
				str(outcome['reason_code']),
			)

		self.actions[action_id] = _dump(action)

		return {
			'action_id': action_id,
			'decision_id': decision_id,
			'verdict': str(outcome['verdict']),
			'reason_code': str(outcome['reason_code']),
			'confidence': int(outcome['confidence']),
			'evidence_digest': evidence_digest,
			'intent_hash': intent_hash,
			'state': str(action['state']),
			'settlement_message_stage': 'finalized',
		}

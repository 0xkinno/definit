# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""
DEFINIT v2 -- ScenarioRegistry
==============================

The v1 policy registry with identical behaviour and the same content hash, so a
v1 policy hash and a v2 policy hash for the same text are equal. The only change
is storage: records are JSON strings in a TreeMap[str, str], for the reason
explained in `finality_vault.py`.

  policy_hash = keccak256(utf8(policy_text))

A policy id can be published exactly once. There is no update path, no delete
path and no administrative override.
"""

import json

import genlayer as gl
from genlayer import *  # noqa: F401,F403
from genlayer.storage import DynArray, TreeMap

POLICY_DOMAIN = 'DEFINIT-POLICY-v1'

REASON_ALREADY_PUBLISHED = 'POLICY_ALREADY_PUBLISHED'
REASON_EMPTY = 'POLICY_EMPTY'
REASON_UNKNOWN = 'POLICY_UNKNOWN'


def _keccak_hex(payload: str) -> str:
	hasher = Keccak256()
	hasher.update(payload.encode('utf-8'))
	return '0x' + hasher.digest().hex()


class ScenarioRegistry(gl.contract.Contract):
	policies: TreeMap[str, str]
	policy_ids: DynArray[str]

	def __init__(self):
		pass

	@gl.public.write
	def publish_policy(
		self, policy_id: str, version: str, title: str, text: str
	) -> str:
		"""Publish a policy once and return its content hash."""
		if len(policy_id) == 0 or len(text) == 0:
			gl.vm.UserError.immediate(REASON_EMPTY)

		if policy_id in self.policies:
			gl.vm.UserError.immediate(REASON_ALREADY_PUBLISHED)

		policy_hash = _keccak_hex(POLICY_DOMAIN + '|' + text)
		self.policies[policy_id] = json.dumps(
			{
				'policy_id': policy_id,
				'version': version,
				'title': title,
				'text': text,
				'policy_hash': policy_hash,
				'published_by': gl.message.sender_address.as_hex.lower(),
				'published_at': str(gl.message.datetime),
			},
			sort_keys=True,
		)
		self.policy_ids.append(policy_id)
		return policy_hash

	@gl.public.view
	def get_policy(self, policy_id: str) -> dict:
		"""Return the full published policy, or an explicit absence marker."""
		if policy_id not in self.policies:
			return {
				'exists': False,
				'policy_id': policy_id,
				'version': '',
				'title': '',
				'text': '',
				'policy_hash': '',
				'reason_code': REASON_UNKNOWN,
			}

		record = json.loads(str(self.policies[policy_id]))
		return {
			'exists': True,
			'policy_id': record['policy_id'],
			'version': record['version'],
			'title': record['title'],
			'text': record['text'],
			'policy_hash': record['policy_hash'],
			'reason_code': '',
		}

	@gl.public.view
	def get_policy_hash(self, policy_id: str) -> str:
		"""Return the hash a decision contract must commit to."""
		if policy_id not in self.policies:
			return ''
		return str(json.loads(str(self.policies[policy_id]))['policy_hash'])

	@gl.public.view
	def list_policies(self) -> list:
		"""Return a bounded catalogue of published policies."""
		out = []
		limit = 50
		total = len(self.policy_ids)
		start = 0 if total <= limit else total - limit
		for i in range(start, total):
			record = json.loads(str(self.policies[self.policy_ids[i]]))
			out.append(
				{
					'policy_id': record['policy_id'],
					'version': record['version'],
					'title': record['title'],
					'policy_hash': record['policy_hash'],
				}
			)
		return out

	@gl.public.view
	def count(self) -> int:
		return len(self.policy_ids)

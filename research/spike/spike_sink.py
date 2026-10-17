# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""
EXPERIMENT CODE, NOT PRODUCT CODE. Phase 0B mechanism spike.

The sink records what the protocol actually delivers: the stage label the
sender claimed, the tag, the address the VM reports as the sender, the chain
time of delivery, and a delivery counter. It makes no decision from any of it.
"""

import genlayer as gl
from genlayer import *  # noqa: F401,F403
from genlayer.storage import DynArray


def _hex(value) -> str:
	if hasattr(value, 'as_hex'):
		return str(value.as_hex).lower()
	return str(value).lower()


class SpikeSink(gl.contract.Contract):
	entries: DynArray[str]
	counter: u256

	def __init__(self):
		self.counter = u256(0)

	@gl.public.write
	def record_accepted(self, tag: str) -> None:
		self._record('accepted', tag)

	@gl.public.write
	def record_finalized(self, tag: str) -> None:
		self._record('finalized', tag)

	@gl.public.write
	def record_fail(self, tag: str) -> None:
		raise Exception('spike child failure on purpose')

	@gl.public.write
	def record(self, stage: str, tag: str) -> None:
		self._record(stage, tag)

	def _record(self, stage: str, tag: str) -> None:
		self.counter = u256(int(self.counter) + 1)
		self.entries.append(
			stage + '|' + tag + '|' + _hex(gl.message.sender_address) + '|'
			+ str(gl.message.datetime) + '|' + str(int(self.counter))
		)

	@gl.public.view
	def get_entries(self) -> list:
		return [str(item) for item in self.entries]

	@gl.public.view
	def get_counter(self) -> int:
		return int(self.counter)
